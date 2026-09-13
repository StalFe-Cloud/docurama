# Docurama Enterprise Deployment (`docurama.stalfe.com`)

This directory contains deployment specifications for running Docurama as an isolated Enterprise self-hosted instance.

## Overview

- **Host**: `https://docurama.stalfe.com`
- **Location on VPS**: `/opt/docurama-enterprise`
- **Port**: `3003` (bound to `172.17.0.1:3003`)
- **Network**: `docurama_enterprise_net`
- **Deployment Mode**: `DOCURAMA_DEPLOYMENT_MODE=selfhost`
- **Data Isolation**: Dedicated PostgreSQL database (`docurama_enterprise_db_data`) and storage volume (`docurama_enterprise_storage`).
- **Signing Authority**: Uses StalFe Document Signing Certificate (`docurama_document_signing_cert.p12` + `docurama_root_ca.crt`).

## Quick Start on VPS

```bash
cd /opt/docurama-enterprise
docker compose -f deploy/enterprise/docker-compose.yml up -d
```

## Reverse Proxy Integration

In `/opt/nexa/infra/nginx/conf.d/docurama.conf`:

```nginx
upstream docurama_enterprise_upstream {
    server 172.17.0.1:3003;
}

server {
    listen 443 ssl;
    server_name docurama.stalfe.com;
    ...
    location / {
        proxy_pass http://docurama_enterprise_upstream;
        ...
    }
}
```
