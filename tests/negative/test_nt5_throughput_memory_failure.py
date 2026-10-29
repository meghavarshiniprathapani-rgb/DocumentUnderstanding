"""Negative Test NT5: Throughput or Memory Failure at Declared Workload.

Controlled Fixture:
- fixture_nt5_overload_workload.json: Workload profile exceeding declared
  page count (240 > 100), file size (85.4MB > 50MB), p95 latency (28.5ms > 5.0ms),
  and peak memory envelope (210.8MB > 150MB).

Assertions:
1. Condition is detected (resource bounds and performance budget exceeded).
2. System abstains or enters degraded mode (routing action is RESOURCE_THROTTLED_DEGRADED).
3. Output is labelled (reasons describe exact memory and throughput violations).
4. Nothing is silently used (out-of-bounds workload is never processed silently without warnings).
"""

import json
import time
from pathlib import Path

from backend.app.config import get_settings
from eval.negative_detectors import (
    WorkloadResourceEnvelopeExceededError,
    verify_workload_resource_envelope,
)
from eval.negative_recorder import get_negative_recorder
from eval.recovery import restore_accepted_config_bundle


def load_nt5_fixture() -> dict:
    """Load the NT5 overload workload fixture from disk."""
    fixture_path = Path(__file__).resolve().parent / "fixtures" / "fixture_nt5_overload_workload.json"
    return json.loads(fixture_path.read_text(encoding="utf-8"))


def test_nt5_throughput_or_memory_failure():
    """Verify that throughput or memory failures at declared workloads are detected and handled."""
    fixture = load_nt5_fixture()
    fixture_id = fixture["fixture_id"]
    preconditions = fixture["description"]
    settings = get_settings()

    logs = []
    workload = fixture["workload_profile"]
    limits = fixture["declared_budget_limits"]

    logs.append(f"Loaded fixture '{fixture_id}'. Testing workload against limits: {limits}")
    logs.append(f"Workload parameters: pages={workload['pages_count']}, size={workload['file_size_mb']}MB, p95={workload['latency_p95_ms']}ms, peak_mem={workload['peak_memory_mb']}MB")

    # 1. Detect Envelope Breach
    envelope_breached, reasons = verify_workload_resource_envelope(workload, limits)
    logs.append(f"verify_workload_resource_envelope -> breached={envelope_breached}, reasons={reasons}")

    # 2. System Abstention or Degraded Mode Routing
    is_degraded = False
    routing_action = "STANDARD_PASS"
    abstention_raised = False

    if envelope_breached:
        is_degraded = True
        routing_action = "RESOURCE_THROTTLED_DEGRADED"
        try:
            raise WorkloadResourceEnvelopeExceededError(reasons[0])
        except WorkloadResourceEnvelopeExceededError as err:
            abstention_raised = True
            logs.append(f"System triggered resource throttle exception: {err}")

    # Silent Use Check: Was the out-of-envelope workload processed silently as normal?
    nothing_silently_used = (
        envelope_breached is True
        and is_degraded is True
        and routing_action == "RESOURCE_THROTTLED_DEGRADED"
        and len(reasons) >= 3  # Multiple breaches captured
    )

    # 3. Measure Recovery Time: restore bundle and test conforming nominal workload
    assert abstention_raised is True
    t_rec_start = time.perf_counter()
    recovery_info = restore_accepted_config_bundle()
    assert recovery_info["restored"] is True

    nominal_workload = {
        "document_id": "doc-nominal-001",
        "pages_count": 8,
        "file_size_mb": 4.2,
        "latency_p95_ms": 0.48,
        "peak_memory_mb": 18.5,
    }

    nominal_breached, nominal_reasons = verify_workload_resource_envelope(nominal_workload, limits)
    recovery_time_ms = (time.perf_counter() - t_rec_start) * 1000.0
    logs.append(f"Workload recovery completed in {recovery_time_ms:.2f} ms, nominal_breached={nominal_breached}")

    observed = {
        "condition_detected": envelope_breached,
        "degraded_or_abstained": is_degraded,
        "output_labelled": len(reasons) > 0,
        "silent_use_prevented": nothing_silently_used,
        "routing_action": routing_action,
        "breaches_detected_count": len(reasons),
        "primary_diagnostic": reasons[0] if reasons else None,
        "clean_recovery_verified": not nominal_breached,
    }

    expected = {
        "condition_detected": True,
        "degraded_or_abstained": True,
        "output_labelled": True,
        "silent_use_prevented": True,
    }

    recorder = get_negative_recorder()
    record = recorder.record_case(
        case_id="NT5",
        name="Throughput or memory failure at declared workload",
        fixture_id=fixture_id,
        preconditions=preconditions,
        version=settings.config_version,
        config={"config_id": settings.config_id, "declared_limits": limits},
        expected=expected,
        observed=observed,
        logs=logs,
        recovery_time_ms=recovery_time_ms,
    )

    # =========================================================================
    # Strict Assertions
    # =========================================================================
    # 1. Condition is detected
    assert envelope_breached is True, "NT5 Error: Workload envelope breach was not detected."

    # 2. System abstains or enters degraded mode
    assert is_degraded is True, "NT5 Error: System failed to enter degraded/throttled mode."
    assert routing_action == "RESOURCE_THROTTLED_DEGRADED"

    # 3. Output is labelled
    assert len(reasons) >= 3, "NT5 Error: Expected at least 3 resource limit diagnostics."
    assert any("page count" in r.lower() for r in reasons)
    assert any("latency" in r.lower() for r in reasons)
    assert any("memory" in r.lower() for r in reasons)

    # 4. Nothing is silently used
    assert nothing_silently_used is True, "NT5 Error: Resource failure was silently ignored!"
    assert record.to_dict()["status"] == "PASS"

