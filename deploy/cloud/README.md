# Docurama Cloud SaaS Deployment (`docurama.eu` / `app.docurama.eu`)

This directory contains deployment specifications for running Docurama as a multi-tenant Cloud SaaS platform.

## Overview

- **Host**: `https://docurama.eu` (Marketing) & `https://app.docurama.eu` (App Platform)
- **Location on VPS**: `/opt/docurama-cloud`
- **Port**: `3002` (bound to `172.17.0.1:3002`)
- **Network**: `docurama_cloud_net`
- **Deployment Mode**: `DOCURAMA_DEPLOYMENT_MODE=cloud`
- **Registration**: Open self-registration (`DOCURAMA_PUBLIC_REGISTRATION=true`)
- **Data Isolation**: Dedicated PostgreSQL database (`docurama_cloud_db_data`) and storage volume (`docurama_cloud_storage`), completely isolated from the Enterprise self-hosted instance.

## Quick Start on VPS

```bash
cd /opt/docurama-cloud
docker compose up -d
```
