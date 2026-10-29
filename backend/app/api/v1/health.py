"""Retrieva AI — Health Check and Recovery Endpoints.

Returns /metrics-style operational telemetry and recovery path trigger.
"""

from typing import Any, Dict

from fastapi import APIRouter, Depends

from backend.app.schemas.common import BaseResponse, HealthData
from backend.app.services import DocumentService, get_document_service

router = APIRouter(prefix="/health", tags=["System Health"])


@router.get("", response_model=BaseResponse[HealthData])
def get_health(
    doc_service: DocumentService = Depends(get_document_service),
) -> BaseResponse[HealthData]:
    """Returns /metrics-style telemetry: model versions, config id, index size, and last error."""
    health_payload = doc_service.get_health_metrics()
    status_msg = "Retrieva AI engine is fully operational" if health_payload.status == "healthy" else "Operating in degraded mode"
    return BaseResponse[HealthData](
        status="success",
        message=status_msg,
        data=health_payload,
    )


@router.post("/reload", response_model=BaseResponse[Dict[str, Any]])
def reload_accepted_config(
    doc_service: DocumentService = Depends(get_document_service),
) -> BaseResponse[Dict[str, Any]]:
    """Recovery path: Reloads the accepted model and configuration bundle, resetting degraded states."""
    reload_result = doc_service.reload_accepted_bundle()
    return BaseResponse[Dict[str, Any]](
        status="success",
        message="Accepted model/config bundle reloaded. Degraded mode reset.",
        data=reload_result,
    )
