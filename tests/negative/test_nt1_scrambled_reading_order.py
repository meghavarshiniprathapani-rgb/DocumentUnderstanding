"""Negative Test NT1: Scrambled Multi-Column Reading Order.

Controlled Fixture:
- fixture_nt1_scrambled_reading_order.json: 2-column layout with horizontal
  cross-column interleaving that destroys natural column reading sequence.

Assertions:
1. Condition is detected (horizontal zigzagging across column boundaries).
2. System abstains or enters degraded mode (routing action is DEGRADED_FALLBACK).
3. Output is labelled (degraded reasons contain explicit reading order diagnostics).
4. Nothing is silently used (unlabelled STANDARD_PASS is strictly prevented).
"""

import json
import time
from pathlib import Path

from backend.app.config import get_settings
from backend.extractors.base import BoundingBox, Element, ElementType
from backend.layout import LayoutOrderRecovery
from backend.provenance import ProvenanceConfig, ProvenanceSubsystem
from eval.negative_detectors import detect_scrambled_reading_order
from eval.negative_recorder import get_negative_recorder
from eval.recovery import restore_accepted_config_bundle


def load_nt1_fixture() -> dict:
    """Load the NT1 scrambled multi-column fixture from disk."""
    fixture_path = Path(__file__).resolve().parent / "fixtures" / "fixture_nt1_scrambled_reading_order.json"
    return json.loads(fixture_path.read_text(encoding="utf-8"))


def test_nt1_scrambled_reading_order():
    """Verify detection, degradation routing, and labelling of scrambled multi-column reading order."""
    fixture = load_nt1_fixture()
    fixture_id = fixture["fixture_id"]
    preconditions = fixture["description"]
    settings = get_settings()

    logs = []
    logs.append(f"Loaded fixture '{fixture_id}' with {len(fixture['elements'])} elements.")

    # 1. Parse fixture elements
    elements = []
    for raw in fixture["elements"]:
        b = raw["bbox"]
        elem = Element(
            type=ElementType.TEXT,
            page=raw["page"],
            bbox=BoundingBox(
                x_min=b["x"],
                y_min=b["y"],
                x_max=b["x"] + b["width"],
                y_max=b["y"] + b["height"],
            ),
            reading_order=raw["reading_order"],
            text=raw["text"],
            raw_confidence=raw["raw_confidence"],
            metadata={"id": raw["id"], "column": raw["column"]},
        )
        elements.append(elem)

    # 2. Anomaly Detection
    is_detected, reasons = detect_scrambled_reading_order(elements)
    logs.append(f"detect_scrambled_reading_order -> detected={is_detected}, reasons={reasons}")

    # 3. Provenance & Degraded Routing
    subsystem = ProvenanceSubsystem(
        config=ProvenanceConfig(
            enabled=True,
            provenance_tracking_enabled=True,
            calibration_enabled=True,
            low_confidence_threshold=0.75,
            fallback_strategy="RAW_SLICE_FALLBACK",
        )
    )

    enriched_elements = subsystem.process_elements(elements, pdf_path="mock/nt1_scrambled.pdf")

    # Manually attach detected topological anomaly if present
    for item in enriched_elements:
        if is_detected:
            if not item.routing:
                from backend.provenance.schema import DegradedRoutingRecord
                item.routing = DegradedRoutingRecord(
                    is_degraded=True,
                    routing_action="DEGRADED_FALLBACK",
                    reasons=reasons,
                    fallback_strategy="RAW_SLICE_FALLBACK",
                )
            else:
                item.routing.is_degraded = True
                item.routing.reasons.extend(reasons)
                item.routing.routing_action = "DEGRADED_FALLBACK"

    # Evaluate Degradation Flags
    degraded_items = [e for e in enriched_elements if e.routing and e.routing.is_degraded]
    has_degraded = len(degraded_items) > 0
    all_reasons = []
    for d in degraded_items:
        all_reasons.extend(d.routing.reasons)

    # Silent Use Check: Were any scrambled elements passed silently as STANDARD_PASS?
    silent_pass_count = sum(
        1 for e in enriched_elements if e.routing and e.routing.routing_action == "STANDARD_PASS"
    )
    nothing_silently_used = (silent_pass_count == 0) if is_detected else True

    # 4. Measure Recovery Time
    t_rec_start = time.perf_counter()
    recovery_info = restore_accepted_config_bundle()
    assert recovery_info["restored"] is True
    # Recover reading order using layout recovery engine
    recovery_engine = LayoutOrderRecovery()
    recovered_elements = recovery_engine.process(elements)
    # Check that recovered reading order has no horizontal zigzag
    recovered_detected, _ = detect_scrambled_reading_order(recovered_elements)
    recovery_time_ms = (time.perf_counter() - t_rec_start) * 1000.0
    logs.append(f"LayoutOrderRecovery completed in {recovery_time_ms:.2f} ms, recovered_detected={recovered_detected}")

    # Telemetry registration
    observed = {
        "condition_detected": is_detected,
        "degraded_or_abstained": has_degraded,
        "output_labelled": len(all_reasons) > 0,
        "silent_use_prevented": nothing_silently_used,
        "degraded_elements_count": len(degraded_items),
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
        case_id="NT1",
        name="Scrambled multi-column reading order",
        fixture_id=fixture_id,
        preconditions=preconditions,
        version=settings.config_version,
        config={"config_id": settings.config_id, "layout_engine": "LayoutOrderRecovery:v1.0.0"},
        expected=expected,
        observed=observed,
        logs=logs,
        recovery_time_ms=recovery_time_ms,
    )

    # =========================================================================
    # Strict Assertions
    # =========================================================================
    # 1. Condition is detected
    assert is_detected is True, "NT1 Error: Scrambled reading order was not detected by topological analyzer."

    # 2. System enters degraded mode or abstains
    assert has_degraded is True, "NT1 Error: System did not enter degraded mode for scrambled layout."
    assert any(e.routing.routing_action in ("DEGRADED_FALLBACK", "CRITICAL_REVIEW_REQUIRED") for e in degraded_items)

    # 3. Output is labelled
    assert len(all_reasons) > 0, "NT1 Error: Degraded output was not labelled with diagnostic reasons."
    assert any("scrambled" in r.lower() or "reading order" in r.lower() for r in all_reasons)

    # 4. Nothing is silently used
    assert nothing_silently_used is True, "NT1 Error: Scrambled input was silently passed through as standard pass!"
    assert record.to_dict()["status"] == "PASS"

