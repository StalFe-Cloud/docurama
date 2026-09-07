# syntax=docker/dockerfile:1
# Docurama Enterprise Container Image
# Copyright (c) 2026 Docurama Technologies. All Rights Reserved.
# https://github.com/Docurama-Cloud/docurama

FROM docuseal/docuseal:latest

LABEL org.opencontainers.image.title="Docurama" \
      org.opencontainers.image.description="Next-Generation Digital Document Signing & Verification Platform" \
      org.opencontainers.image.vendor="Docurama Technologies" \
      org.opencontainers.image.version="1.0.0" \
      org.opencontainers.image.source="https://github.com/Docurama-Cloud/docurama"

# Set Docurama environment defaults
ENV PRODUCT_NAME=Docurama \
    APP_NAME=Docurama \
    PORT=3000 \
    FORCE_SSL=true \
    TIMESERVER_URL=http://timestamp.digicert.com

WORKDIR /app

# 1. Bake brand assets & theme
COPY overlay/custom_public/ /app/public/
COPY overlay/custom_public/docurama-theme.css /app/public/docurama-theme.css

# 2. Bake PDF sealing logos
COPY overlay/custom_pdf_icons/ /app/lib/pdf_icons/

# 3. Bake custom controllers
COPY overlay/custom_controllers/ /app/app/controllers/

# 4. Bake custom models & audit generator with vector QR verification
COPY overlay/custom_lib/docuseal.rb /app/lib/docuseal.rb
COPY overlay/custom_lib/submissions/generate_audit_trail.rb /app/lib/submissions/generate_audit_trail.rb

# 5. Bake custom background jobs
COPY overlay/custom_jobs/ /app/app/jobs/

# 6. Bake custom routing, initializers, and locales
COPY overlay/custom_config/routes.rb /app/config/routes.rb
COPY overlay/custom_config/locales/i18n.yml /app/config/locales/i18n.yml
COPY overlay/custom_config/initializers/session_store.rb /app/config/initializers/session_store.rb

# 7. Bake all 40+ custom views (Plus Jakarta Sans, dark-glass UI, relocated settings)
COPY overlay/custom_views/ /app/app/views/

# 8. Bake custom error pages
COPY overlay/custom_views/errors/404.html /app/public/404.html
COPY overlay/custom_views/errors/422.html /app/public/422.html
COPY overlay/custom_views/errors/500.html /app/public/500.html

# 9. Scrub legacy strings from asset packs at build time
COPY scripts/patch_packs.rb /tmp/patch_packs.rb
RUN ruby /tmp/patch_packs.rb && rm -f /tmp/patch_packs.rb

EXPOSE 3000

CMD ["./bin/rails", "server", "-b", "0.0.0.0", "-p", "3000"]
