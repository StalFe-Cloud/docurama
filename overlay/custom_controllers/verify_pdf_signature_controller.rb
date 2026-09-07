# frozen_string_literal: true

class VerifyPdfSignatureController < ApplicationController
  skip_before_action :authenticate_user!, raise: false
  skip_authorization_check

  def index
    if params[:envelope].present? || params[:id].present? || params[:slug].present?
      key = (params[:envelope] || params[:id] || params[:slug]).to_s.strip
      @submission = Submission.find_by(id: key) || Submission.find_by(slug: key)
      if @submission
        @template = @submission.template
        @submitters = @submission.submitters
        @completed = @submission.completed_at.present?
        @digest = Digest::SHA256.hexdigest(@submission.slug)
        @is_verified = true
      end
    end
    render :index, layout: 'plain'
  end

  def create
    account = current_account || Account.order(:id).first
    trusted_certs = Accounts.load_trusted_certs(account)

    signatures =
      params[:files].to_a.map do |file|
        VerifyPdfSignature.call(file.open, trusted_certs)
      end

    render turbo_stream: turbo_stream.replace('result', partial: 'result',
                                                        locals: { signatures:, files: params[:files] })
  rescue Pdfium::PdfiumError
    render turbo_stream: turbo_stream.replace('result', html: helpers.tag.div(I18n.t('invalid_pdf'), id: 'result'))
  end
end
