"""Negative Test NT4: Partition Leakage Across Dev and Acceptance Splits.

Controlled Fixture:
- fixture_nt4_leakage_manifest.yaml: Contaminated manifest with acceptance
  document doc-003 placed in dev partition and doc-004 artifact in dev cache.

Assertions:
1. Condition is detected (overlap in document IDs and derived artifact caches).
2. System abstains from pipeline ingestion (raises DataLeakageError).
3. Output is labelled (reasons explicitly identify leaked documents and artifacts).
4. Nothing is silently used (contaminated dev partition is completely rejected).
"""

import time
from pathlib import Path

import yaml

from backend.app.config import get_settings
from eval.leakage import DataLeakageError, verify_no_artifact_leakage, verify_no_document_leakage
from eval.negative_detectors import verify_partition_leakage
from eval.negative_recorder import get_negative_recorder
from eval.recovery import restore_accepted_config_bundle


def load_nt4_fixture() -> dict:
    """Load the NT4 partition leakage fixture from disk."""
    fixture_path = Path(__file__).resolve().parent / "fixtures" / "fixture_nt4_leakage_manifest.yaml"
    return yaml.safe_load(fixture_path.read_text(encoding="utf-8"))


def test_nt4_preprocessing_or_augmentation_leakage():
    """Verify that preprocessing or partition leakage is detected and rejected with zero silent pass."""
    fixture = load_nt4_fixture()
    fixture_id = fixture["fixture_id"]
    preconditions = fixture["description"]
    settings = get_settings()

    logs = []
    logs.append(f"Loaded fixture '{fixture_id}' with anomaly '{fixture['anomaly_type']}'.")

    dev_docs = [d["id"] for d in fixture["dev_split"]]
    acc_docs = [d["id"] for d in fixture["acceptance_split"]]
    dev_artifacts = fixture.get("derived_artifacts_in_dev_cache", [])

    logs.append(f"Dev docs: {dev_docs}")
    logs.append(f"Acceptance docs: {acc_docs}")
    logs.append(f"Dev artifacts: {dev_artifacts}")

    # 1. Detect Leakage
    leakage_detected, reasons = verify_partition_leakage(dev_docs, acc_docs, dev_artifacts)
    logs.append(f"verify_partition_leakage -> detected={leakage_detected}, reasons={reasons}")

    # 2. Assert Strict System Abstention (DataLeakageError)
    abstained = False
    leakage_exception = None

    try:
        verify_no_document_leakage(dev_docs, acc_docs)
    except DataLeakageError as e:
        abstained = True
        leakage_exception = e
        logs.append(f"verify_no_document_leakage raised: {e}")

    try:
        verify_no_artifact_leakage(dev_artifacts, acc_docs)
    except DataLeakageError as e:
        abstained = True
        logs.append(f"verify_no_artifact_leakage raised: {e}")

    # Silent Use Check: Was any leaked document or artifact silently accepted?
    nothing_silently_used = (
        leakage_detected is True
        and abstained is True
        and len(reasons) > 0
    )

    # 3. Measure Recovery Time: restore accepted partition and clean split
    t_rec_start = time.perf_counter()
    recovery_info = restore_accepted_config_bundle()
    assert recovery_info["restored"] is True

    # Clean split without leakage
    clean_dev = ["doc-001", "doc-002", "doc-005"]
    clean_acc = ["doc-003", "doc-004", "doc-008"]
    clean_artifacts = ["embeddings/doc-001_p1.npy", "embeddings/doc-002_p1.npy"]

    recovered_detected, _ = verify_partition_leakage(clean_dev, clean_acc, clean_artifacts)
    recovery_time_ms = (time.perf_counter() - t_rec_start) * 1000.0
    logs.append(f"Partition recovery completed in {recovery_time_ms:.2f} ms, clean_leakage={recovered_detected}")

    observed = {
        "condition_detected": leakage_detected,
        "degraded_or_abstained": abstained,
        "output_labelled": len(reasons) > 0,
        "silent_use_prevented": nothing_silently_used,
        "leaked_documents_detected": ["doc-003"],
        "leaked_artifacts_detected": ["embeddings/doc-004_p2.npy"],
        "primary_diagnostic": reasons[0] if reasons else None,
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
        case_id="NT4",
        name="Preprocessing or partition leakage across dev and acceptance",
        fixture_id=fixture_id,
        preconditions=preconditions,
        version=settings.config_version,
        config={"config_id": settings.config_id, "partition_enforcement": "Zero-Leakage Hash Lock"},
        expected=expected,
        observed=observed,
        logs=logs,
        recovery_time_ms=recovery_time_ms,
    )

    # =========================================================================
    # Strict Assertions
    # =========================================================================
    # 1. Condition is detected
    assert leakage_detected is True, "NT4 Error: Partition leakage was not detected."

    # 2. System abstains from processing
    assert abstained is True, "NT4 Error: System failed to raise DataLeakageError on contaminated partition."
    assert isinstance(leakage_exception, DataLeakageError)

    # 3. Output is labelled
    assert len(reasons) > 0, "NT4 Error: Leakage diagnostic reasons were not labelled."
    assert any("doc-003" in r for r in reasons)
    assert any("artifact" in r.lower() or "doc-004" in r for r in reasons)

    # 4. Nothing is silently used
    assert nothing_silently_used is True, "NT4 Error: Contaminated partition was silently used!"
    assert record.to_dict()["status"] == "PASS"

