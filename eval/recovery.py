"""Retrieva AI — Configuration Bundle Recovery & Verification Script.

Restores the accepted model and configuration bundle:
1. Resets runtime degraded state and error buffers.
2. Restores default calibrated thresholds and configuration flags (O3-v1.0.0).
3. Verifies cryptographic integrity of data/acceptance.lock.
4. Reruns the affected negative test class (NT1 - NT5 or all) to confirm recovery.

Usage:
    python -m eval.recovery --case NT1
    python -m eval.recovery --case all
"""

import argparse
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict

import pytest

from backend.app.services.document_service import DocumentService
from backend.provenance import ProvenanceConfig
from eval.leakage import verify_acceptance_lock


def restore_accepted_config_bundle() -> Dict[str, Any]:
    """Restores the verified configuration bundle, resets degraded modes, and checks partition lock.

    Returns:
        Telemetry dictionary detailing restored bundle status, lock status, and recovery duration.
    """
    t_start = time.perf_counter()
    repo_root = Path(__file__).resolve().parent.parent

    # 1. Verify Acceptance Lock File Integrity
    lock_file = repo_root / "data" / "acceptance.lock"
    manifest_file = repo_root / "data" / "manifest.yaml"
    lock_valid = False
    lock_hash = None

    if lock_file.exists() and manifest_file.exists():
        try:
            lock_info = verify_acceptance_lock(manifest_file, lock_file)
            lock_valid = True
            lock_hash = lock_info.get("acceptance_hash")
        except Exception:
            lock_valid = False

    # 2. Restore Provenance & Subsystem Configuration
    accepted_config = ProvenanceConfig(
        enabled=True,
        provenance_tracking_enabled=True,
        calibration_enabled=True,
        low_confidence_threshold=0.75,
        critical_scene_strict_threshold=0.85,
        fallback_strategy="RAW_SLICE_FALLBACK",
        config_id="O3-v1.0.0",
        platt_scale_a=0.92,
        platt_shift_b=-0.05,
    )

    # 3. Reset Service Degraded State
    doc_service = DocumentService()
    service_status = doc_service.reload_accepted_bundle()

    t_elapsed_ms = (time.perf_counter() - t_start) * 1000.0

    return {
        "restored": True,
        "config_id": accepted_config.config_id,
        "lock_verified": lock_valid,
        "lock_hash": lock_hash,
        "low_confidence_threshold": accepted_config.low_confidence_threshold,
        "critical_strict_threshold": accepted_config.critical_scene_strict_threshold,
        "fallback_strategy": accepted_config.fallback_strategy,
        "service_status": service_status,
        "recovery_time_ms": round(t_elapsed_ms, 2),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


CASE_TO_TEST_FILE = {
    "NT1": "tests/negative/test_nt1_scrambled_reading_order.py",
    "NT2": "tests/negative/test_nt2_flattened_tables.py",
    "NT3": "tests/negative/test_nt3_unverified_extraction.py",
    "NT4": "tests/negative/test_nt4_partition_leakage.py",
    "NT5": "tests/negative/test_nt5_throughput_memory_failure.py",
    "ALL": "tests/negative/test_negative_suite.py",
}


def rerun_affected_class(case_key: str = "ALL") -> Dict[str, Any]:
    """Reruns the specified negative test case or the entire negative suite via pytest."""
    repo_root = Path(__file__).resolve().parent.parent
    case_upper = case_key.upper()

    target_file = CASE_TO_TEST_FILE.get(case_upper, CASE_TO_TEST_FILE["ALL"])
    test_path = str(repo_root / target_file)

    print(f"\n[*] Restoring accepted bundle and rerunning: {case_upper} -> {target_file}")
    t0 = time.perf_counter()

    # Run pytest directly on targeted test module
    exit_code = pytest.main(["-v", test_path, "-s"])
    elapsed_ms = (time.perf_counter() - t0) * 1000.0

    success = (exit_code == pytest.ExitCode.OK)
    print(f"[*] Rerun Result for {case_upper}: {'PASS' if success else 'FAIL'} in {elapsed_ms:.2f}ms")

    return {
        "case": case_upper,
        "target_file": target_file,
        "pytest_exit_code": int(exit_code),
        "success": success,
        "elapsed_ms": round(elapsed_ms, 2),
    }


def main() -> None:
    """CLI entrypoint for bundle recovery and negative regression testing."""
    parser = argparse.ArgumentParser(description="Retrieva AI Bundle Recovery & Negative Test Suite Runner")
    parser.add_argument(
        "--case",
        choices=["NT1", "NT2", "NT3", "NT4", "NT5", "all", "ALL"],
        default="all",
        help="Specify which affected negative test case to rerun (default: all)",
    )
    args = parser.parse_args()

    print("=" * 70)
    print("      RETRIEVA AI -- ACCEPTED CONFIG BUNDLE RECOVERY PATH      ")
    print("=" * 70)

    # 1. Restore Bundle
    restore_info = restore_accepted_config_bundle()
    print(f"  Configuration Bundle ID  : {restore_info['config_id']}")
    print(f"  Acceptance Lock Verified : {restore_info['lock_verified']}")
    print(f"  Confidence Threshold     : {restore_info['low_confidence_threshold']}")
    print(f"  Restoration Latency      : {restore_info['recovery_time_ms']} ms")
    print("-" * 70)

    # 2. Rerun Affected Class
    rerun_result = rerun_affected_class(args.case)
    print("=" * 70)

    if not rerun_result["success"]:
        sys.exit(1)


if __name__ == "__main__":
    main()

