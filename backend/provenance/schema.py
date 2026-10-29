"""Schemas for Provenance Records, Multi-Signal Confidence, and Routing."""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from backend.extractors.base import BoundingBox, Element


class ProvenanceRecord(BaseModel):
    """Cryptographic audit trail and extraction lineage for a document element."""

    element_id: str = Field(..., description="Unique deterministic identifier for the element")
    source_file_hash: str = Field(..., description="SHA-256 hash of the source PDF document")
    page_number: int = Field(..., ge=1, description="1-indexed page number")
    bbox: BoundingBox = Field(..., description="Spatial coordinates of the element")
    extractor_name: str = Field(..., description="Name of the extractor backend (e.g. Docling, PyMuPDF)")
    extractor_version: str = Field(..., description="Version of the extractor backend")
    config_id: str = Field(..., description="Configuration identifier in effect during extraction")
    extraction_timestamp: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="ISO 8601 UTC timestamp when extraction was performed",
    )
    parent_element_id: Optional[str] = Field(
        default=None,
        description="ID of parent container element (e.g. parent section, table, or document root)",
    )


class ConfidenceSignals(BaseModel):
    """Decomposition of element confidence into raw model score and independent signals."""

    raw_confidence: float = Field(..., ge=0.0, le=1.0, description="Extractor model raw confidence")
    dual_agreement_score: Optional[float] = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="Cross-extractor spatial IoU and text similarity agreement",
    )
    table_consistency_score: Optional[float] = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="Topological consistency of table cells (grid bounds, monotonic indices)",
    )
    reading_order_score: Optional[float] = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="Reading sequence concordance score",
    )
    combined_confidence: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Weighted combination of raw confidence and independent signals",
    )
    calibrated_confidence: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Platt-scaled calibrated probability that the extraction is accurate",
    )


class DegradedRoutingRecord(BaseModel):
    """Routing metadata for elements falling below the operational confidence threshold."""

    is_degraded: bool = Field(default=False, description="True if element is flagged for degraded handling")
    routing_action: str = Field(
        default="STANDARD_PASS",
        description="Action applied: STANDARD_PASS, DEGRADED_FALLBACK, or CRITICAL_REVIEW_REQUIRED",
    )
    reasons: List[str] = Field(
        default_factory=list,
        description="Diagnostic explanations for low confidence or degraded routing",
    )
    fallback_strategy: str = Field(
        default="NONE",
        description="Fallback mechanism executed (e.g. RAW_SLICE_FALLBACK, BOUNDING_BOX_UNION)",
    )
    fallback_data: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Auxiliary fallback payload for degraded paths",
    )
    timestamp: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="Routing execution timestamp",
    )


class ReliabilityBin(BaseModel):
    """Single bin for reliability curve / Expected Calibration Error (ECE) analysis."""

    bin_index: int
    bin_lower: float
    bin_upper: float
    element_count: int
    mean_confidence: float
    accuracy: float
    calibration_error: float


class CalibrationReport(BaseModel):
    """Evaluation summary of confidence calibration."""

    expected_calibration_error: float = Field(..., description="Expected Calibration Error (ECE) [0.0, 1.0]")
    max_calibration_error: float = Field(..., description="Maximum Calibration Error (MCE) [0.0, 1.0]")
    brier_score: float = Field(..., description="Mean squared difference between confidence and ground truth")
    num_samples: int
    bins: List[ReliabilityBin]


class EnrichedElement(BaseModel):
    """Document Element enriched with O3 Provenance, Calibrated Confidence, and Routing."""

    element: Element
    provenance: Optional[ProvenanceRecord] = None
    confidence_signals: Optional[ConfidenceSignals] = None
    routing: Optional[DegradedRoutingRecord] = None

    @property
    def calibrated_confidence(self) -> Optional[float]:
        """Convenience accessor for Platt calibrated confidence score."""
        if self.confidence_signals:
            return self.confidence_signals.calibrated_confidence
        return None

    model_config = {
        "arbitrary_types_allowed": True,
    }
