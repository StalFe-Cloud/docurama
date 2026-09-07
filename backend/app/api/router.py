from fastapi import APIRouter
from app.api import auth, envelopes, templates, signing, verify, ws, domains, folders, webhooks

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(envelopes.router)
api_router.include_router(templates.router)
api_router.include_router(folders.router, prefix="/folders", tags=["folders"])
api_router.include_router(webhooks.router, prefix="/webhooks", tags=["webhooks"])
api_router.include_router(signing.router)
api_router.include_router(verify.router)
api_router.include_router(domains.router)
