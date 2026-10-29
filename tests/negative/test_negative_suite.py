"""Retrieva AI — Negative Anomaly & Degradation Suite Orchestrator.

Executes all 5 controlled negative test cases (NT1 - NT5), asserts zero silent
failures across every condition, and writes comprehensive telemetry to:
/eval/results/negative_<timestamp>.json
"""

import json
from datetime import datetime, timezone

from eval.negative_recorder import get_negative_recorder
from tests.negative.test_nt1_scrambled_reading_order import (
    test_nt1_scrambled_reading_order as run_nt1,
)
from tests.negative.test_nt2_flattened_tables import (
    test_nt2_tables_flattened_into_noise as run_nt2,
)
from tests.negative.test_nt3_unverified_extraction import (
    test_nt3_extraction_scored_without_downstream_retrieval_check as run_nt3,
)
from tests.negative.test_nt4_partition_leakage import (
    test_nt4_preprocessing_or_augmentation_leakage as run_nt4,
)
from tests.negative.test_nt5_throughput_memory_failure import (
    test_nt5_throughput_or_memory_failure as run_nt5,
)


def test_full_negative_suite_and_record_results():
    """Executes NT1 through NT5, validates all assertions, and writes negative_<timestamp>.json."""
    # 1. Run all 5 negative anomaly cases
    run_nt1()
    run_nt2()
    run_nt3()
    run_nt4()
    run_nt5()

    # 2. Persist results to /eval/results/negative_<timestamp>.json
    recorder = get_negative_recorder()
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    results_path = recorder.save_results(timestamp=timestamp)

    assert results_path.exists(), f"Negative results file not found at {results_path}"

    # 3. Validate saved JSON structure and required fields
    data = json.loads(results_path.read_text(encoding="utf-8"))

    assert data["summary"]["total_negative_cases"] == 5
    assert data["summary"]["passed_cases"] == 5
    assert data["summary"]["failed_cases"] == 0
    assert data["summary"]["all_conditions_detected"] is True
    assert data["summary"]["all_abstain_or_degraded"] is True
    assert data["summary"]["all_outputs_labelled"] is True
    assert data["summary"]["zero_silent_failures"] is True

    # Check each individual case in JSON
    for case_id in ["NT1", "NT2", "NT3", "NT4", "NT5"]:
        assert case_id in data["cases"], f"Case {case_id} missing in results JSON"
        case_data = data["cases"][case_id]

        # Assert mandatory recorded fields per Prompt requirements
        assert "fixture_id" in case_data and case_data["fixture_id"]
        assert "preconditions" in case_data and case_data["preconditions"]
        assert "version" in case_data and case_data["version"]
        assert "config" in case_data and isinstance(case_data["config"], dict)
        assert "expected" in case_data and isinstance(case_data["expected"], dict)
        assert "observed" in case_data and isinstance(case_data["observed"], dict)
        assert "logs" in case_data and isinstance(case_data["logs"], list) and len(case_data["logs"]) > 0
        assert "recovery_time_ms" in case_data and case_data["recovery_time_ms"] >= 0.0
        assert case_data["status"] == "PASS"

    print(f"\n[+] Negative test suite successfully written to: {results_path}")

