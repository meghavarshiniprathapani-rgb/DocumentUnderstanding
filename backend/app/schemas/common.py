"""Retrieva AI — Common API Schemas.

Standardized base responses guaranteeing config_version recording across all outputs.
Includes spatial bounding boxes, segments, search items, and metrics-style health payload.
"""

from datetime import datetime, timezone
from typing import Any, Dict, Generic, List, Optional, TypeVar

from pydantic import BaseModel, Field

from backend.app.config import get_settings

T = TypeVar("T")


class BaseResponse(BaseModel, Generic[T]):
    """Universal envelope schema for all Retrieva AI API endpoints.

    Explicitly embeds the active config_version string in every serialized output.
    """

    config_version: str = Field(
        default_factory=lambda: get_settings().config_version,
        description="Configuration version string active when this output was produced",
    )
    status: str = Field(default="success", description="Operational status ('success', 'error', 'pending')")
    message: Optional[str] = Field(default=None, description="Human-readable informational or error message")
    data: Optional[T] = Field(default=None, description="Payload data")
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="ISO 8601 UTC timestamp of response generation",
    )


class HealthData(BaseModel):
    """Metrics-style health data payload."""

    service: str
    status: str  # "healthy" or "degraded"
    environment: str
    config_version: str
    config_id: str
    model_versions: Dict[str, str] = Field(
        default_factory=dict,
        description="Active versions of extractor, embedding, and layout models",
    )
    index_size: int = Field(default=0, description="Total number of chunk vectors indexed in FAISS")
    documents_count: int = Field(default=0, description="Total documents registered in repository")
    degraded_mode_active: bool = Field(default=False, description="Whether degraded fallback mode is triggered")
    last_error: Optional[Dict[str, Any]] = Field(default=None, description="Details of the last recorded error")
    uptime_seconds: float = Field(default=0.0, description="Service uptime in seconds")
    memory_usage_mb: float = Field(default=0.0, description="Current memory consumption in MB")
    ocr_engine: str
    vector_db: str
    confidence_threshold: float
    max_upload_size_mb: int
    max_pages_per_document: int


class BoundingBox(BaseModel):
    """2D spatial coordinates on an 800x1100 normalized document canvas."""

    x: float
    y: float
    width: float
    height: float


class SegmentSchema(BaseModel):
    """Layout segment entity representation."""

    id: str
    type: str  # heading, text, table, formula, figure, chart
    label: str
    confidence: float
    bbox: BoundingBox
    text: str
    page: int
    reading_order: int = Field(default=0, description="1D reading order index within page")
    table_data: Optional[Dict[str, Any]] = None
    formula_latex: Optional[str] = None
    provenance: Optional[Dict[str, Any]] = None
    calibrated_confidence: Optional[float] = None
    is_degraded: bool = Field(default=False, description="True if segment was routed to degraded fallback path")
    degraded_reasons: List[str] = Field(default_factory=list, description="Diagnostic reasons for degraded flag")


class DocumentMetrics(BaseModel):
    """Structural element counts extracted from document."""

    text_blocks: int
    tables: int
    figures: int
    headings: int


class DocumentSummary(BaseModel):
    """Metadata summary of an ingested document."""

    document_id: str
    title: str
    category: str
    file_size: str
    pages_count: int
    status: str
    parsing_accuracy: float
    metrics: DocumentMetrics
    uploaded_at: str
    file_hash: Optional[str] = None
    is_degraded: bool = False
    extraction_status: str = "Completed"
    indexing_status: str = "Indexed"
    chunk_count: int = 0
    error_details: Optional[str] = None
    config_version: str = "1.0.0"


class BatchItemStatus(BaseModel):
    filename: str
    document_id: Optional[str] = None
    file_hash: Optional[str] = None
    file_size: str = "0 B"
    status: str = "Queued"
    progress_percent: int = 0
    error: Optional[str] = None
    summary: Optional[DocumentSummary] = None


class BatchUploadResponse(BaseModel):
    batch_id: str
    total_files: int
    successful_count: int
    failed_count: int
    duplicate_count: int
    items: List[BatchItemStatus]


class SearchQueryRequest(BaseModel):
    """Payload for multi-modal spatial queries."""

    query: str = Field(..., min_length=1, description="Search query string")
    document_id: Optional[str] = Field(default="All", description="Target document ID or 'All'")
    document_ids: Optional[List[str]] = Field(default=None, description="Target document IDs to search across")
    content_type: Optional[str] = Field(default="All", description="Segment type filter")
    min_score: Optional[float] = Field(default=0.50, ge=0.0, le=1.0)
    page_range: Optional[str] = Field(default=None, description="Page range slice, e.g., '1-5'")
    top_k: Optional[int] = Field(default=10, ge=1, le=50)


class SearchResultItem(BaseModel):
    """Matched search result item with spatial coordinates, provenance, and table preview."""

    id: str
    document_id: str
    document_title: str
    category: str
    page_number: int
    result_title: str
    content_type: str
    relevance_score: float
    query_match_snippet: str
    bounding_region: BoundingBox
    table_data: Optional[Dict[str, Any]] = None
    highlights: List[str] = Field(default_factory=list)
    reading_order: int = Field(default=0, description="Recovered reading order sequence")
    provenance: Optional[Dict[str, Any]] = Field(default=None, description="Cryptographic audit lineage")
    confidence: float = Field(default=1.0, ge=0.0, le=1.0, description="Base confidence score")
    calibrated_confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0, description="Platt-calibrated confidence")
    is_degraded: bool = Field(default=False, description="Whether this extraction or retrieval is degraded")
    degraded_reasons: List[str] = Field(default_factory=list, description="Diagnostic reasons for degraded flag")
    fallback_strategy: Optional[str] = Field(default=None, description="Active fallback strategy if degraded")


class CrossDocumentEvidence(BaseModel):
    consensus_topics: List[Dict[str, Any]] = Field(default_factory=list)
    document_specific: List[Dict[str, Any]] = Field(default_factory=list)
    divergences: List[Dict[str, Any]] = Field(default_factory=list)
    coverage_summary: Dict[str, Any] = Field(default_factory=dict)


class MultiDocumentSearchResponse(BaseModel):
    results: List[SearchResultItem]
    evidence_aggregation: CrossDocumentEvidence
    total_matches: int
    documents_searched: List[str]
    documents_matched: List[str]
