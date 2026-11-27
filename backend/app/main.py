"""Retrieva AI — FastAPI Main Application.

Bootstraps FastAPI engine, CORS middleware, config version header injection,
request timing, structured logging, and real extraction/retrieval routes.
"""

import json
import logging
import os
import sys
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, AsyncGenerator, Dict

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.app.api.v1.router import api_v1_router
from backend.app.config import get_settings
from backend.app.schemas.common import BaseResponse
from backend.app.services import get_document_service

# Structured JSON Logger Configuration
logger = logging.getLogger("retrieva_api")
logger.setLevel(logging.INFO)
handler = logging.StreamHandler(sys.stdout)
handler.setFormatter(logging.Formatter("%(message)s"))
if not logger.handlers:
    logger.addHandler(handler)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application startup and shutdown lifecycle management."""
    settings = get_settings()
    doc_service = get_document_service()
    express_url = (os.getenv("EXPRESS_SERVICE_URL") or settings.express_service_url or "").strip()
    recovery_summary: Dict[str, Any] = {"synced": False, "recovered_count": 0}
    if express_url and (os.getenv("EXPRESS_SERVICE_URL") is not None or "PYTEST_CURRENT_TEST" not in os.environ):
        recovery_summary = doc_service.sync_from_express_recovery(
            express_url=express_url,
            internal_secret=os.getenv("INTERNAL_API_SECRET") or settings.internal_api_secret,
            force=True,
        )
    health_snapshot = doc_service.get_health_metrics()
    startup_log = {
        "event": "startup",
        "service": settings.app_name,
        "config_version": settings.config_version,
        "config_id": settings.config_id,
        "environment": settings.environment,
        "instance_id": health_snapshot.instance_id,
        "indexed_chunks": health_snapshot.index_size,
        "documents_count": health_snapshot.documents_count,
        "degraded_mode_active": health_snapshot.degraded_mode_active,
        "recovered_from_mysql": recovery_summary.get("recovered_count", 0),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    logger.info(json.dumps(startup_log))
    yield
    shutdown_log = {
        "event": "shutdown",
        "service": settings.app_name,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    logger.info(json.dumps(shutdown_log))


def create_app() -> FastAPI:
    """Factory creating and configuring the FastAPI application instance."""
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        version=settings.config_version,
        description="Retrieva AI — Multi-Modal Document Understanding & Spatial Retrieval Backend",
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        lifespan=lifespan,
    )

    # Cross-Origin Resource Sharing (CORS) Middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Middleware: Request timing, structured JSON logging, and header injection
    @app.middleware("http")
    async def request_timing_and_logging_middleware(request: Request, call_next) -> Response:
        t0 = time.perf_counter()
        doc_service = get_document_service()
        doc_service.total_requests += 1

        try:
            response: Response = await call_next(request)
        except Exception as exc:
            duration_ms = round((time.perf_counter() - t0) * 1000.0, 2)
            doc_service.record_error(str(exc), request.url.path)
            error_log = {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "level": "ERROR",
                "method": request.method,
                "path": request.url.path,
                "error": str(exc),
                "duration_ms": duration_ms,
                "config_version": settings.config_version,
            }
            logger.error(json.dumps(error_log))
            return JSONResponse(
                status_code=500,
                headers={
                    "X-Config-Version": settings.config_version,
                    "X-Process-Time-Ms": str(duration_ms),
                },
                content={
                    "config_version": settings.config_version,
                    "status": "error",
                    "message": f"Internal server error: {str(exc)}",
                    "data": None,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
            )

        duration_ms = round((time.perf_counter() - t0) * 1000.0, 2)
        response.headers["X-Config-Version"] = settings.config_version
        response.headers["X-Process-Time-Ms"] = str(duration_ms)

        # Structured access log
        log_entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": "INFO",
            "method": request.method,
            "path": request.url.path,
            "status_code": response.status_code,
            "duration_ms": duration_ms,
            "config_version": settings.config_version,
        }
        logger.info(json.dumps(log_entry))

        return response

    # Include API v1 Router
    app.include_router(api_v1_router, prefix=settings.api_prefix)

    # Root Discovery Endpoint
    @app.get("/", response_model=BaseResponse[dict])
    def root_discovery() -> BaseResponse[dict]:
        """Root API discovery endpoint recording config_version and available routes."""
        return BaseResponse[dict](
            status="success",
            message="Welcome to Retrieva AI Document Understanding Engine",
            data={
                "service": settings.app_name,
                "docs": "/docs",
                "api_v1": settings.api_prefix,
                "health": f"{settings.api_prefix}/health",
            },
        )

    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "backend.app.main:app",
        host=settings.host,
        port=settings.port,
        reload=(settings.environment == "development"),
    )
