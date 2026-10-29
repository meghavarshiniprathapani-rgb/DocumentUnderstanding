"""Unit tests for the Provenance, Confidence Calibration, and Routing Subsystem (O3)."""

from pathlib import Path

import pytest

from backend.extractors.base import BoundingBox, Element, ElementType, TableCell
from backend.provenance import (
    CalibrationReport,
    ConfidenceSignals,
    DegradedPathRouter,
    ProvenanceConfig,
    ProvenanceSubsystem,
    apply_platt_scaling,
    compute_dual_extractor_agreement,
    compute_expected_calibration_error,
    compute_file_sha256,
    compute_table_structural_consistency,
    fit_platt_parameters,
)


@pytest.fixture
def sample_pdf_path():
    p = Path("data/sample_documents/doc-001.pdf")
    if not p.exists():
        pytest.skip("doc-001.pdf placeholder not found")
    return p


@pytest.fixture
def mock_elements():
    return [
        Element(
            type=ElementType.HEADING,
            page=1,
            bbox=BoundingBox(x_min=50.0, y_min=50.0, x_max=500.0, y_max=80.0),
            reading_order=0,
            text="Document Executive Summary",
            raw_confidence=0.95,
            metadata={"id": "elem_head"},
        ),
        Element(
            type=ElementType.TABLE,
            page=1,
            bbox=BoundingBox(x_min=50.0, y_min=100.0, x_max=500.0, y_max=250.0),
            reading_order=1,
            text="Col A | Col B\nVal 1 | Val 2",
            table_cells=[
                TableCell(row_index=0, col_index=0, row_span=1, col_span=1, text="Col A", is_header=True),
                TableCell(row_index=0, col_index=1, row_span=1, col_span=1, text="Col B", is_header=True),
                TableCell(row_index=1, col_index=0, row_span=1, col_span=1, text="Val 1", is_header=False),
                TableCell(row_index=1, col_index=1, row_span=1, col_span=1, text="Val 2", is_header=False),
            ],
            raw_confidence=0.60,  # Low initial confidence
            metadata={"id": "elem_tbl", "is_critical": True},
        ),
    ]


def test_subsystem_toggle_off(sample_pdf_path, mock_elements):
    """Verify that when config.enabled = False, subsystem passes elements through untouched."""
    config = ProvenanceConfig(enabled=False)
    subsystem = ProvenanceSubsystem(config=config)

    enriched = subsystem.process_elements(mock_elements, sample_pdf_path)
    assert len(enriched) == len(mock_elements)
    for e in enriched:
        assert e.provenance is None
        assert e.confidence_signals is None
        assert e.routing is None


def test_provenance_record_generation(sample_pdf_path, mock_elements):
    """Verify cryptographic file hash and provenance lineage fields."""
    config = ProvenanceConfig(enabled=True, config_id="O3-test-v1")
    subsystem = ProvenanceSubsystem(config=config)

    enriched = subsystem.process_elements(
        mock_elements,
        sample_pdf_path,
        extractor_name="PyMuPDF_pdfplumber",
        extractor_version="1.0.0",
    )

    expected_hash = compute_file_sha256(sample_pdf_path)
    assert len(expected_hash) == 64  # Valid SHA-256

    for e in enriched:
        assert e.provenance is not None
        assert e.provenance.source_file_hash == expected_hash
        assert e.provenance.config_id == "O3-test-v1"
        assert e.provenance.extractor_name == "PyMuPDF_pdfplumber"
        assert e.provenance.page_number == 1
        assert e.provenance.element_id.startswith(expected_hash[:8])
        assert "T" in e.provenance.extraction_timestamp  # ISO format


def test_dual_extractor_agreement():
    """Verify spatial and textual agreement between extractors."""
    el = Element(
        type=ElementType.TEXT,
        page=1,
        bbox=BoundingBox(x_min=10.0, y_min=10.0, x_max=100.0, y_max=50.0),
        reading_order=0,
        text="Revenue grew by 20% year over year.",
    )

    # Identical secondary element -> near 1.0 agreement
    identical_sec = [
        Element(
            type=ElementType.TEXT,
            page=1,
            bbox=BoundingBox(x_min=10.0, y_min=10.0, x_max=100.0, y_max=50.0),
            reading_order=0,
            text="Revenue grew by 20% year over year.",
        )
    ]
    score_identical = compute_dual_extractor_agreement(el, identical_sec)
    assert score_identical >= 0.99

    # Completely disjoint secondary element -> 0.0 agreement
    disjoint_sec = [
        Element(
            type=ElementType.TEXT,
            page=1,
            bbox=BoundingBox(x_min=300.0, y_min=400.0, x_max=500.0, y_max=500.0),
            reading_order=0,
            text="Completely unrelated footer disclaimer.",
        )
    ]
    score_disjoint = compute_dual_extractor_agreement(el, disjoint_sec)
    assert score_disjoint == 0.0


def test_table_structural_consistency():
    """Verify table topological grid consistency scoring."""
    valid_table = Element(
        type=ElementType.TABLE,
        page=1,
        bbox=BoundingBox(x_min=0.0, y_min=0.0, x_max=100.0, y_max=100.0),
        reading_order=0,
        text="A | B\n1 | 2",
        table_cells=[
            TableCell(row_index=0, col_index=0, row_span=1, col_span=1, text="A"),
            TableCell(row_index=0, col_index=1, row_span=1, col_span=1, text="B"),
            TableCell(row_index=1, col_index=0, row_span=1, col_span=1, text="1"),
            TableCell(row_index=1, col_index=1, row_span=1, col_span=1, text="2"),
        ],
    )
    score_valid = compute_table_structural_consistency(valid_table)
    assert score_valid == 1.0

    # Table with empty cells list -> 0.0
    empty_table = Element(
        type=ElementType.TABLE,
        page=1,
        bbox=BoundingBox(x_min=0.0, y_min=0.0, x_max=100.0, y_max=100.0),
        reading_order=0,
        table_cells=[],
    )
    assert compute_table_structural_consistency(empty_table) == 0.0


def test_expected_calibration_error_toy_sample():
    """Verify ECE and reliability curve with known mathematical distributions."""
    # Perfect calibration: confidence 0.8 with 80% accuracy, confidence 0.2 with 20% accuracy
    confidences = [0.8] * 10 + [0.2] * 10
    accuracies = [1] * 8 + [0] * 2 + [1] * 2 + [0] * 8

    report = compute_expected_calibration_error(confidences, accuracies, num_bins=10)
    assert isinstance(report, CalibrationReport)
    # Both non-empty bins have mean_conf == accuracy, so calibration error is 0.0
    assert report.expected_calibration_error == 0.0
    assert report.num_samples == 20

    # Severely overconfident predictions: 1.0 confidence on all, but only 50% accurate
    overconf_conf = [0.95] * 20
    overconf_acc = [1] * 10 + [0] * 10
    overconf_report = compute_expected_calibration_error(overconf_conf, overconf_acc, num_bins=10)
    # Expected error is |0.95 - 0.50| = 0.45
    assert abs(overconf_report.expected_calibration_error - 0.45) < 1e-3


def test_platt_scaling_and_parameter_fitting():
    """Verify Platt scaling sigmoid mapping and parameter estimation."""
    calibrated = apply_platt_scaling(0.50, scale_a=1.0, shift_b=0.0)
    # At logit(0.5) = 0.0, sigmoid(0.0) = 0.50
    assert abs(calibrated - 0.50) < 1e-2

    raw_confs = [0.1, 0.2, 0.4, 0.6, 0.8, 0.9]
    accs = [0, 0, 0, 1, 1, 1]
    a, b = fit_platt_parameters(raw_confs, accs)
    assert a > 0.0  # Slope must be positive


def test_degraded_path_routing():
    """Verify that low-confidence elements are routed to degraded path with diagnostic reasons."""
    config = ProvenanceConfig(
        low_confidence_threshold=0.75,
        critical_scene_strict_threshold=0.85,
        fallback_strategy="BOUNDING_BOX_UNION",
    )
    router = DegradedPathRouter(config)

    # Standard element with low confidence (0.60 < 0.75)
    low_conf_signals = ConfidenceSignals(
        raw_confidence=0.60,
        combined_confidence=0.60,
        calibrated_confidence=0.60,
    )
    elem = Element(
        type=ElementType.TEXT,
        page=1,
        bbox=BoundingBox(x_min=10.0, y_min=10.0, x_max=100.0, y_max=50.0),
        reading_order=0,
        text="Ambiguous text",
    )
    route_low = router.evaluate_and_route(elem, low_conf_signals, is_critical=False)
    assert route_low.is_degraded is True
    assert route_low.routing_action == "DEGRADED_FALLBACK"
    assert len(route_low.reasons) > 0
    assert route_low.fallback_strategy == "BOUNDING_BOX_UNION"
    assert "expanded_bbox" in route_low.fallback_data

    # High confidence element (0.92 >= 0.75)
    high_conf_signals = ConfidenceSignals(
        raw_confidence=0.92,
        combined_confidence=0.92,
        calibrated_confidence=0.92,
    )
    route_high = router.evaluate_and_route(elem, high_conf_signals, is_critical=False)
    assert route_high.is_degraded is False
    assert route_high.routing_action == "STANDARD_PASS"
    assert len(route_high.reasons) == 0

    # Critical element with 0.80 (< strict threshold 0.85)
    route_critical = router.evaluate_and_route(elem, ConfidenceSignals(
        raw_confidence=0.80,
        combined_confidence=0.80,
        calibrated_confidence=0.80,
    ), is_critical=True)
    assert route_critical.is_degraded is True
    assert route_critical.routing_action == "CRITICAL_REVIEW_REQUIRED"
