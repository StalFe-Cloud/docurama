from fastapi import APIRouter
from app.api import auth, envelopes, templates, signing, verify, ws, domains

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(envelopes.router)
api_router.include_router(templates.router)
api_router.include_router(signing.router)
api_router.include_router(verify.router)
api_router.include_router(domains.router)
