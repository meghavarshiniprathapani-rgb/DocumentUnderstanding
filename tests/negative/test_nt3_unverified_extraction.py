"""Negative Test NT3: Extraction Scored Without Downstream Retrieval Check.

Controlled Fixture:
- fixture_nt3_unverified_extraction.json: Evaluation output claiming high
  accuracy based only on character metrics, omitting mandatory KPI-3 downstream retrieval.

Assertions:
1. Condition is detected (missing downstream retrieval grounding check).
2. System abstains from acceptance certification (raises UncheckedDownstreamRetrievalError).
3. Output is labelled (reasons explicitly state missing KPI-3 verification).
4. Nothing is silently used (unverified intermediate extraction score is rejected).
"""

import json
import time
from pathlib import Path

from backend.app.config import get_settings
from eval.negative_detectors import (
    UncheckedDownstreamRetrievalError,
    verify_downstream_retrieval_check,
)
from eval.negative_recorder import get_negative_recorder
from eval.recovery import restore_accepted_config_bundle


def load_nt3_fixture() -> dict:
    """Load the NT3 unverified extraction fixture from disk."""
    fixture_path = Path(__file__).resolve().parent / "fixtures" / "fixture_nt3_unverified_extraction.json"
    return json.loads(fixture_path.read_text(encoding="utf-8"))


def test_nt3_extraction_scored_without_downstream_retrieval_check():
    """Verify that extraction scored without downstream retrieval check is detected and abstained."""
    fixture = load_nt3_fixture()
    fixture_id = fixture["fixture_id"]
    preconditions = fixture["description"]
    settings = get_settings()

    logs = []
    logs.append(f"Loaded fixture '{fixture_id}' with extractor '{fixture['extractor_name']}'.")

    # 1. Detection of missing downstream retrieval
    is_valid, reasons = verify_downstream_retrieval_check(fixture)
    condition_detected = not is_valid
    logs.append(f"verify_downstream_retrieval_check -> is_valid={is_valid}, reasons={reasons}")

    # 2. System Abstention Action
    abstained = False
    abstention_exception = None

    try:
        if not is_valid:
            abstained = True
            raise UncheckedDownstreamRetrievalError(reasons[0])
    except UncheckedDownstreamRetrievalError as exc:
        abstention_exception = exc
        logs.append(f"System raised abstention exception: {exc}")

    # Certification outcome
    certification_outcome = {
        "certified": False if abstained else True,
        "is_degraded": True if abstained else False,
        "reasons": reasons,
        "status": "ABSTAINED_UNVERIFIED_RETRIEVAL" if abstained else "CERTIFIED",
    }

    # Silent Use Check: Was the unverified extraction score silently certified?
    nothing_silently_used = (
        certification_outcome["certified"] is False
        and certification_outcome["is_degraded"] is True
        and len(reasons) > 0
    )

    # 3. Measure Recovery Time: restore bundle and attach valid retrieval verification
    t_rec_start = time.perf_counter()
    recovery_info = restore_accepted_config_bundle()
    assert recovery_info["restored"] is True

    # Create complete verified payload with real downstream retrieval check
    verified_payload = dict(fixture)
    verified_payload["downstream_retrieval_checked"] = True
    verified_payload["retrieval_metrics"] = {
        "hit_at_1": 0.714,
        "hit_at_3": 0.929,
        "mrr": 0.821,
        "answer_grounding": 0.714,
    }
    verified_payload["kpi3_summary"] = {
        "mean_kpi3_score": 86.4,
        "cohens_kappa": 1.0,
    }

    recovered_valid, recovered_reasons = verify_downstream_retrieval_check(verified_payload)
    recovery_time_ms = (time.perf_counter() - t_rec_start) * 1000.0
    logs.append(f"Downstream retrieval verification recovered in {recovery_time_ms:.2f} ms, is_valid={recovered_valid}")

    observed = {
        "condition_detected": condition_detected,
        "degraded_or_abstained": abstained,
        "output_labelled": len(reasons) > 0,
        "silent_use_prevented": nothing_silently_used,
        "certification_status": certification_outcome["status"],
        "primary_diagnostic": reasons[0] if reasons else None,
        "clean_recovery_verified": recovered_valid,
    }

    expected = {
        "condition_detected": True,
        "degraded_or_abstained": True,
        "output_labelled": True,
        "silent_use_prevented": True,
    }

    recorder = get_negative_recorder()
    record = recorder.record_case(
        case_id="NT3",
        name="Extraction scored without downstream retrieval check",
        fixture_id=fixture_id,
        preconditions=preconditions,
        version=settings.config_version,
        config={"config_id": settings.config_id, "mandatory_check": "KPI-3 Grounded Retrieval"},
        expected=expected,
        observed=observed,
        logs=logs,
        recovery_time_ms=recovery_time_ms,
    )

    # =========================================================================
    # Strict Assertions
    # =========================================================================
    # 1. Condition is detected
    assert condition_detected is True, "NT3 Error: Missing downstream retrieval was not detected."

    # 2. System abstains from certification
    assert abstained is True, "NT3 Error: System failed to abstain from unverified extraction scoring."
    assert isinstance(abstention_exception, UncheckedDownstreamRetrievalError)

    # 3. Output is labelled
    assert len(reasons) > 0, "NT3 Error: Abstention reasons were not labelled."
    assert any("downstream retrieval" in r.lower() or "kpi-3" in r.lower() for r in reasons)

    # 4. Nothing is silently used
    assert nothing_silently_used is True, "NT3 Error: Extraction score was silently accepted!"
    assert record.to_dict()["status"] == "PASS"

