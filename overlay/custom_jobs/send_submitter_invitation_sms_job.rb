# frozen_string_literal: true

class SendSubmitterInvitationSmsJob
  include Sidekiq::Job
  sidekiq_options queue: :sms

  def perform(params = {})
    submitter = Submitter.find_by(id: params['submitter_id'])
    return unless submitter
    return if submitter.completed_at?
    return if submitter.declined_at?
    return if submitter.phone.blank?

    sms_config = EncryptedConfig.find_by(account: submitter.account, key: 'sms_configs')
    return unless sms_config&.value&.present?

    config = sms_config.value
    return unless config['enabled'] == '1' || config['enabled'] == true

    provider = config['provider'] || 'twilio'
    phone = submitter.phone
    template_name = submitter.template&.name || 'Document'
    sign_url = submitter.url

    body = config['message_template'].presence || "Please review and sign {{template_name}}: {{sign_url}}"
    body = body.gsub('{{template_name}}', template_name).gsub('{{sign_url}}', sign_url)

    if provider == 'twilio' && config['account_sid'].present? && config['auth_token'].present?
      require 'net/http'
      require 'uri'

      account_sid = config['account_sid']
      auth_token = config['auth_token']
      from_number = config['from_number']

      uri = URI("https://api.twilio.com/2010-04-01/Accounts/#{account_sid}/Messages.json")
      req = Net::HTTP::Post.new(uri)
      req.basic_auth(account_sid, auth_token)
      req.set_form_data({
        'To' => phone,
        'From' => from_number,
        'Body' => body
      })

      res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true) do |http|
        http.request(req)
      end

      if res.is_a?(Net::HTTPSuccess)
        SubmissionEvent.create!(submitter: submitter, event_type: 'send_sms')
        submitter.update_column(:sent_at, Time.current) unless submitter.sent_at?
      else
        Rails.logger.error("Twilio SMS send error: #{res.code} #{res.body}")
      end
    end
  rescue StandardError => e
    Rails.logger.error("SendSubmitterInvitationSmsJob failed: #{e.message}")
  end
end
