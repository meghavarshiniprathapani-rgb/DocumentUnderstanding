"""
Retrieva AI — API v1 Router Aggregator
Combines health, documents, and search sub-routers under /api/v1.
"""

from fastapi import APIRouter

from backend.app.api.v1.documents import router as documents_router
from backend.app.api.v1.evaluation import router as evaluation_router
from backend.app.api.v1.health import router as health_router
from backend.app.api.v1.search import router as search_router

api_v1_router = APIRouter()
api_v1_router.include_router(health_router)
api_v1_router.include_router(documents_router)
api_v1_router.include_router(search_router)
api_v1_router.include_router(evaluation_router)
