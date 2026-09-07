# frozen_string_literal: true

module Docurama
  PRODUCT_URL = 'https://docurama.example.com'
  PRODUCT_EMAIL_URL = ENV.fetch('DOCURAMA_PRODUCT_EMAIL_URL', ENV.fetch('PRODUCT_EMAIL_URL', PRODUCT_URL))
  NEWSLETTER_URL = "#{PRODUCT_URL}/newsletters".freeze
  ENQUIRIES_URL = "#{PRODUCT_URL}/enquiries".freeze
  PRODUCT_NAME = 'Docurama'
  DEFAULT_APP_URL = ENV.fetch('DOCURAMA_APP_URL', ENV.fetch('APP_URL', 'https://docurama.example.com'))
  GITHUB_URL = 'https://docurama.example.com'
  DISCORD_URL = 'https://docurama.example.com'
  TWITTER_URL = 'https://docurama.example.com'
  TWITTER_HANDLE = '@docurama'
  CHATGPT_URL = "#{PRODUCT_URL}".freeze
  SUPPORT_EMAIL = 'support@docurama.com'
  HOST = ENV.fetch('DOCURAMA_HOST', ENV.fetch('HOST', 'docurama.example.com'))
  AATL_CERT_NAME = 'docurama_aatl'
  CONSOLE_URL = '/settings'
  CLOUD_URL = '/settings'
  CDN_URL = "https://#{HOST}"

  CERTS = JSON.parse(ENV.fetch('DOCURAMA_CERTS', ENV.fetch('CERTS', '{}')))
  TIMESERVER_URL = ENV.fetch('DOCURAMA_TIMESERVER_URL', ENV.fetch('TIMESERVER_URL', nil))
  VERSION_FILE_PATH = Rails.root.join('.version')
  VERSION_FILE2_PATH = Rails.public_path.join('version')

  DEFAULT_URL_OPTIONS = {
    host: HOST,
    protocol: 'https'
  }.freeze

  module_function

  def version
    '1.0.0'
  end

  def multitenant?
    ENV['DOCURAMA_MULTITENANT'] == 'true' || ENV['MULTITENANT'] == 'true'
  end

  def advanced_formats?
    multitenant?
  end

  def demo?
    ENV['DEMO'] == 'true'
  end

  def active_storage_public?
    ENV['DOCURAMA_ACTIVE_STORAGE_PUBLIC'] == 'true' || ENV['ACTIVE_STORAGE_PUBLIC'] == 'true'
  end

  def default_pkcs
    return if Docurama::CERTS['enabled'] == false

    @default_pkcs ||= if Docurama::CERTS['cert'].present?
                        GenerateCertificate.load_pkcs(Docurama::CERTS)
                      else
                        account = Account.order(:id).first
                        cert_data = EncryptedConfig.find_by(account:, key: EncryptedConfig::ESIGN_CERTS_KEY)&.value || {}
                        custom = cert_data['custom']&.find { |e| e['data'].present? }
                        if custom
                          OpenSSL::PKCS12.new(Base64.urlsafe_decode64(custom['data']), custom['password'].to_s)
                        elsif cert_data['cert'].present?
                          GenerateCertificate.load_pkcs(cert_data)
                        end
                      end
  end

  def fulltext_search?
    return @fulltext_search unless @fulltext_search.nil?

    @fulltext_search =
      if SearchEntry.table_exists?
        Docurama.multitenant? || AccountConfig.exists?(key: :fulltext_search, value: true)
      else
        false
      end
  end

  def enable_pwa?
    true
  end

  def pdf_format
    @pdf_format ||= (ENV['DOCURAMA_PDF_FORMAT'] || ENV['PDF_FORMAT']).to_s.downcase
  end

  def trusted_certs
    @trusted_certs ||=
      (ENV['DOCURAMA_TRUSTED_CERTS'] || ENV['TRUSTED_CERTS']).to_s.gsub('\\n', "\n").split("\n\n").map do |base64|
        OpenSSL::X509::Certificate.new(base64)
      end
  end

  def default_url_options
    { host: HOST, protocol: 'https' }
  end

  def product_name
    PRODUCT_NAME
  end

  def refresh_default_url_options!
    @default_url_options = nil
  end
end

Docuseal = Docurama unless defined?(Docuseal)
