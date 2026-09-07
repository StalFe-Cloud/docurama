# frozen_string_literal: true

Rails.application.config.session_store :cookie_store, key: '_docurama_session', same_site: :lax, secure: Rails.env.production?
