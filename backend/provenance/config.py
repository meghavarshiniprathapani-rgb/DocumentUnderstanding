"""Configuration module for the Provenance and Confidence Subsystem (O3).

Can be switched on or off globally via the `enabled` flag.
"""

from typing import Literal

from pydantic import BaseModel, Field


class ProvenanceConfig(BaseModel):
    """Configuration settings for provenance tracking, multi-signal confidence, and routing."""

    # Subsystem master toggle
    enabled: bool = Field(
        default=True,
        description="Master switch for the Provenance & Confidence subsystem (O3).",
    )

    # Provenance tracking
    provenance_tracking_enabled: bool = Field(
        default=True,
        description="Whether to generate cryptographic file hashes and provenance audit records.",
    )
    config_id: str = Field(
        default="O3-v1.0.0",
        description="Configuration identifier recorded in all provenance records.",
    )

    # Multi-signal confidence combination weights (sum to 1.0)
    weight_raw_confidence: float = Field(
        default=0.40,
        ge=0.0,
        le=1.0,
        description="Weight assigned to extractor's raw model confidence score.",
    )
    weight_dual_agreement: float = Field(
        default=0.35,
        ge=0.0,
        le=1.0,
        description="Weight assigned to agreement between primary and secondary extractors.",
    )
    weight_table_consistency: float = Field(
        default=0.15,
        ge=0.0,
        le=1.0,
        description="Weight assigned to table topological/grid consistency.",
    )
    weight_reading_order_agreement: float = Field(
        default=0.10,
        ge=0.0,
        le=1.0,
        description="Weight assigned to concordance with layout analysis reading order.",
    )

    # Confidence calibration parameters (Platt scaling: 1 / (1 + exp(-(A * logit + B))))
    calibration_enabled: bool = Field(
        default=True,
        description="Whether to apply calibrated scaling to combined confidence scores.",
    )
    platt_scale_a: float = Field(
        default=1.20,
        description="Platt scaling slope parameter A (calibrated on dev set).",
    )
    platt_shift_b: float = Field(
        default=-0.15,
        description="Platt scaling intercept parameter B (calibrated on dev set).",
    )
    calibration_num_bins: int = Field(
        default=10,
        ge=5,
        le=20,
        description="Number of equal-width bins for Expected Calibration Error (ECE) computation.",
    )

    # Degraded path routing thresholds
    low_confidence_threshold: float = Field(
        default=0.75,
        ge=0.0,
        le=0.99,
        description="Confidence threshold below which elements are flagged and routed to degraded path.",
    )
    critical_scene_strict_threshold: float = Field(
        default=0.85,
        ge=0.50,
        le=1.0,
        description="Stricter confidence threshold applied to designated critical elements.",
    )
    fallback_strategy: Literal["RAW_SLICE_FALLBACK", "BOUNDING_BOX_UNION", "HUMAN_REVIEW_QUEUE"] = Field(
        default="RAW_SLICE_FALLBACK",
        description="Degraded path execution strategy for low-confidence extractions.",
    )
