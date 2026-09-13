from fastapi import APIRouter
from app.api import (
    auth, envelopes, templates, signing, verify, ws, domains, folders, webhooks,
    documents, companies, settings_api, stamps, onboarding, quotas,
    billing, admin, legal, compliance, pricing,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(companies.router)
api_router.include_router(envelopes.router)
api_router.include_router(templates.router)
api_router.include_router(documents.router)
api_router.include_router(folders.router, prefix="/folders", tags=["folders"])
api_router.include_router(webhooks.router, prefix="/webhooks", tags=["webhooks"])
api_router.include_router(signing.router)
api_router.include_router(verify.router)
api_router.include_router(domains.router)
api_router.include_router(settings_api.router)
api_router.include_router(stamps.router)
api_router.include_router(onboarding.router)
api_router.include_router(quotas.router)
# Sprint 3 cloud-launch surfaces: billing (inert until operator keys), the
# platform admin console, and the public legal intake.
api_router.include_router(billing.router)
# Sprint 8: public pricing engine (35-day cycles, commitment ladder, Fair Exit).
api_router.include_router(pricing.router)
api_router.include_router(admin.router)
api_router.include_router(legal.router)
# Compliance & Trust Foundation: admin surface (audit chains, DSAR, retention,
# incidents, controls) plus the public trust-center payload.
api_router.include_router(compliance.router)
api_router.include_router(compliance.public_router)

