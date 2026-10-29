"""Provenance, Calibrated Multi-Signal Confidence, and Routing Subsystem (O3)."""

from backend.provenance.calibration import (
    apply_platt_scaling,
    combine_confidence_signals,
    compute_expected_calibration_error,
    fit_platt_parameters,
)
from backend.provenance.config import ProvenanceConfig
from backend.provenance.routing import DegradedPathRouter
from backend.provenance.schema import (
    CalibrationReport,
    ConfidenceSignals,
    DegradedRoutingRecord,
    EnrichedElement,
    ProvenanceRecord,
    ReliabilityBin,
)
from backend.provenance.signals import (
    compute_dual_extractor_agreement,
    compute_file_sha256,
    compute_reading_order_agreement,
    compute_table_structural_consistency,
)
from backend.provenance.subsystem import ProvenanceSubsystem

__all__ = [
    "ProvenanceConfig",
    "ProvenanceRecord",
    "ConfidenceSignals",
    "DegradedRoutingRecord",
    "CalibrationReport",
    "ReliabilityBin",
    "EnrichedElement",
    "ProvenanceSubsystem",
    "DegradedPathRouter",
    "compute_file_sha256",
    "compute_dual_extractor_agreement",
    "compute_table_structural_consistency",
    "compute_reading_order_agreement",
    "combine_confidence_signals",
    "apply_platt_scaling",
    "compute_expected_calibration_error",
    "fit_platt_parameters",
]

