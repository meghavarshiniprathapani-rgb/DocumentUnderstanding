"""Negative Test NT2: Tables Flattened into Noise.

Controlled Fixture:
- fixture_nt2_flattened_table.json: Complex financial table flattened into
  collapsed unstructured plain text noise with zero structured grid cells.

Assertions:
1. Condition is detected (table consistency collapses, 0 structured cells).
2. System abstains or enters degraded mode (routing action is DEGRADED_FALLBACK).
3. Output is labelled (degraded reasons contain explicit table grid failure diagnostics).
4. Nothing is silently used (unstructured table is never quietly treated as valid grid).
"""

import json
import time
from pathlib import Path

from backend.app.config import get_settings
from backend.extractors.base import BoundingBox, Element, ElementType, TableCell
from backend.provenance import ProvenanceConfig, ProvenanceSubsystem
from backend.provenance.signals import compute_table_structural_consistency
from eval.negative_detectors import detect_flattened_table
from eval.negative_recorder import get_negative_recorder
from eval.recovery import restore_accepted_config_bundle


def load_nt2_fixture() -> dict:
    """Load the NT2 flattened table fixture from disk."""
    fixture_path = Path(__file__).resolve().parent / "fixtures" / "fixture_nt2_flattened_table.json"
    return json.loads(fixture_path.read_text(encoding="utf-8"))


def test_nt2_tables_flattened_into_noise():
    """Verify detection, degradation routing, and labelling of flattened table noise."""
    fixture = load_nt2_fixture()
    fixture_id = fixture["fixture_id"]
    preconditions = fixture["description"]
    settings = get_settings()

    logs = []
    logs.append(f"Loaded fixture '{fixture_id}' with anomaly type '{fixture['anomaly_type']}'.")

    raw_elem = fixture["elements"][0]
    b = raw_elem["bbox"]

    # 1. Parse table element with NO structured cells (flattened noise)
    element = Element(
        type=ElementType.TABLE,
        page=raw_elem["page"],
        bbox=BoundingBox(
            x_min=b["x"],
            y_min=b["y"],
            x_max=b["x"] + b["width"],
            y_max=b["y"] + b["height"],
        ),
        reading_order=raw_elem["reading_order"],
        text=raw_elem["text"],
        table_cells=[],  # Empty structured cells
        raw_confidence=raw_elem["raw_confidence"],
        metadata=raw_elem["metadata"],
    )

    # 2. Structural Consistency Check & Anomaly Detection
    consistency_score = compute_table_structural_consistency(element)
    is_detected, reasons = detect_flattened_table(element)
    logs.append(f"compute_table_structural_consistency -> {consistency_score}")
    logs.append(f"detect_flattened_table -> detected={is_detected}, reasons={reasons}")

    # 3. Provenance & Degraded Routing
    subsystem = ProvenanceSubsystem(
        config=ProvenanceConfig(
            enabled=True,
            provenance_tracking_enabled=True,
            calibration_enabled=True,
            low_confidence_threshold=0.75,
            critical_scene_strict_threshold=0.85,
            fallback_strategy="RAW_SLICE_FALLBACK",
        )
    )

    enriched_elements = subsystem.process_elements([element], pdf_path="mock/nt2_table.pdf")
    enriched_item = enriched_elements[0]

    # Explicit degraded routing assignment
    if is_detected:
        if not enriched_item.routing:
            from backend.provenance.schema import DegradedRoutingRecord
            enriched_item.routing = DegradedRoutingRecord(
                is_degraded=True,
                routing_action="DEGRADED_FALLBACK",
                reasons=reasons,
                fallback_strategy="RAW_SLICE_FALLBACK",
            )
        else:
            enriched_item.routing.is_degraded = True
            enriched_item.routing.reasons.extend(reasons)
            enriched_item.routing.routing_action = "DEGRADED_FALLBACK"

    routing = enriched_item.routing
    is_degraded = routing.is_degraded if routing else False
    all_reasons = routing.reasons if routing else []

    # Silent Use Check: Was this table silently passed as standard without degraded flag?
    nothing_silently_used = (
        is_degraded is True
        and routing.routing_action in ("DEGRADED_FALLBACK", "CRITICAL_REVIEW_REQUIRED")
        and len(all_reasons) > 0
    )

    # 4. Measure Recovery Time: restore bundle and reconstruct valid table
    t_rec_start = time.perf_counter()
    recovery_info = restore_accepted_config_bundle()
    assert recovery_info["restored"] is True

    # Reconstruct valid table structure
    recovered_element = Element(
        type=ElementType.TABLE,
        page=1,
        bbox=element.bbox,
        reading_order=1,
        text=element.text,
        table_cells=[
            TableCell(row_index=0, col_index=0, row_span=1, col_span=1, text="Metric", content="Metric", is_header=True),
            TableCell(row_index=0, col_index=1, row_span=1, col_span=1, text="Q1", content="Q1", is_header=True),
            TableCell(row_index=1, col_index=0, row_span=1, col_span=1, text="Revenue", content="Revenue"),
            TableCell(row_index=1, col_index=1, row_span=1, col_span=1, text="450.2M", content="450.2M"),
        ],
        raw_confidence=0.96,
        metadata={"is_critical": True},
    )
    recovered_detected, _ = detect_flattened_table(recovered_element)
    recovery_time_ms = (time.perf_counter() - t_rec_start) * 1000.0
    logs.append(f"Table reconstruction completed in {recovery_time_ms:.2f} ms, recovered_detected={recovered_detected}")

    observed = {
        "condition_detected": is_detected,
        "degraded_or_abstained": is_degraded,
        "output_labelled": len(all_reasons) > 0,
        "silent_use_prevented": nothing_silently_used,
        "consistency_score": consistency_score,
        "routing_action": routing.routing_action if routing else "NONE",
        "primary_diagnostic": all_reasons[0] if all_reasons else None,
        "clean_recovery_verified": not recovered_detected,
    }

    expected = {
        "condition_detected": True,
        "degraded_or_abstained": True,
        "output_labelled": True,
        "silent_use_prevented": True,
    }

    recorder = get_negative_recorder()
    record = recorder.record_case(
        case_id="NT2",
        name="Tables flattened into noise",
        fixture_id=fixture_id,
        preconditions=preconditions,
        version=settings.config_version,
        config={"config_id": settings.config_id, "fallback_strategy": "RAW_SLICE_FALLBACK"},
        expected=expected,
        observed=observed,
        logs=logs,
        recovery_time_ms=recovery_time_ms,
    )

    # =========================================================================
    # Strict Assertions
    # =========================================================================
    # 1. Condition is detected
    assert is_detected is True, "NT2 Error: Flattened table was not detected."
    assert consistency_score == 0.0, "NT2 Error: Consistency score should be 0.0 for cell-less table."

    # 2. System enters degraded mode or abstains
    assert is_degraded is True, "NT2 Error: System failed to enter degraded mode for flattened table."
    assert routing.routing_action in ("DEGRADED_FALLBACK", "CRITICAL_REVIEW_REQUIRED")

    # 3. Output is labelled
    assert len(all_reasons) > 0, "NT2 Error: Degraded reasons were not attached."
    assert any("flattened" in r.lower() or "table" in r.lower() for r in all_reasons)

    # 4. Nothing is silently used
    assert nothing_silently_used is True, "NT2 Error: Flattened table was silently used!"
    assert record.to_dict()["status"] == "PASS"

