"""
Retrieva AI — Evidence Layer & Partition Leakage Unit Tests
Ensures zero data leakage between Dev and Frozen Independent Acceptance partitions.
"""

import json
from copy import deepcopy
from pathlib import Path

import pytest

from eval.leakage import (
    DataLeakageError,
    extract_doc_id_from_identifier,
    run_leakage_audit,
    verify_acceptance_lock,
    verify_no_artifact_leakage,
    verify_no_document_leakage,
    verify_no_page_leakage,
)
from eval.partition import (
    load_manifest,
    split_documents,
)


def test_manifest_schema_and_required_fields():
    """
    Validates data/manifest.yaml against required fields:
    - id
    - source_url
    - access_date
    - licence
    - owner_custodian
    - document_type
    - layout_type
    - has_tables
    - has_formulas
    - kpi
    """
    manifest_data = load_manifest("data/manifest.yaml")
    docs = manifest_data["documents"]
    assert len(docs) >= 5, "Manifest must contain at least 5 document records"

    required_keys = {
        "id",
        "source_url",
        "access_date",
        "licence",
        "owner_custodian",
        "document_type",
        "layout_type",
        "has_tables",
        "has_formulas",
        "kpi",
    }

    doc_ids = set()
    for doc in docs:
        missing = required_keys - set(doc.keys())
        assert not missing, f"Document {doc.get('id')} missing required fields: {missing}"

        assert isinstance(doc["id"], str) and doc["id"].strip(), "ID must be non-empty string"
        assert doc["id"] not in doc_ids, f"Duplicate document ID: {doc['id']}"
        doc_ids.add(doc["id"])

        assert doc["source_url"].startswith("http"), f"Invalid source_url: {doc['source_url']}"
        assert isinstance(doc["has_tables"], bool), "has_tables must be boolean"
        assert isinstance(doc["has_formulas"], bool), "has_formulas must be boolean"
        assert doc["document_type"] in [
            "financial report",
            "academic paper",
            "form",
            "legal",
            "compliance policy",
            "technical whitepaper",
        ]
        assert doc["layout_type"] in ["single-column", "multi-column", "mixed", "form-grid"]


def test_split_by_document_never_by_page():
    """
    Ensures splitting partitions entire documents without splitting pages.
    Partitions must be mutually exclusive and collectively exhaustive.
    """
    manifest_data = load_manifest("data/manifest.yaml")
    docs = manifest_data["documents"]

    dev_docs, acc_docs = split_documents(docs, acceptance_ratio=0.30, seed=42)

    dev_ids = {d["id"] for d in dev_docs}
    acc_ids = {d["id"] for d in acc_docs}

    # Strict mutual exclusion
    assert dev_ids.isdisjoint(acc_ids), f"Partitions overlap! Overlap: {dev_ids & acc_ids}"

    # Strict collective exhaustiveness
    all_ids = {d["id"] for d in docs}
    assert dev_ids.union(acc_ids) == all_ids, "Missing documents in partition union"

    # Strict non-empty partitions
    assert len(dev_ids) > 0, "Dev partition must not be empty"
    assert len(acc_ids) > 0, "Acceptance partition must not be empty"


def test_deterministic_fixed_seed_partitioning():
    """Identical seed must produce identical partition splits."""
    manifest_data = load_manifest("data/manifest.yaml")
    docs = manifest_data["documents"]

    dev_a, acc_a = split_documents(docs, acceptance_ratio=0.30, seed=42)
    dev_b, acc_b = split_documents(docs, acceptance_ratio=0.30, seed=42)

    assert [d["id"] for d in dev_a] == [d["id"] for d in dev_b]
    assert [d["id"] for d in acc_a] == [d["id"] for d in acc_b]

    # Different seed should produce different split
    dev_c, acc_c = split_documents(docs, acceptance_ratio=0.30, seed=999)
    assert [d["id"] for d in acc_a] != [d["id"] for d in acc_c]


def test_acceptance_lock_file_hash_verification():
    """Cryptographic verification of data/acceptance.lock against manifest records."""
    lock_data = verify_acceptance_lock(manifest_path="data/manifest.yaml", lock_path="data/acceptance.lock")
    assert lock_data["status"] == "FROZEN_LOCKED"
    assert len(lock_data["acceptance_document_ids"]) > 0
    assert len(lock_data["acceptance_hash"]) == 64  # Valid SHA-256 hex string


def test_tampered_acceptance_lock_fails():
    """Tampering with acceptance lock hash must trigger DataLeakageError."""
    lock_file = Path("data/acceptance.lock")
    with open(lock_file, "r", encoding="utf-8") as f:
        original_lock = json.load(f)

    # Tamper with stored hash
    tampered_lock = deepcopy(original_lock)
    tampered_lock["acceptance_hash"] = "0" * 64

    tmp_lock_path = lock_file.parent / "tampered_acceptance.lock"
    with open(tmp_lock_path, "w", encoding="utf-8") as f:
        json.dump(tampered_lock, f)

    try:
        with pytest.raises(DataLeakageError, match="Acceptance lock hash mismatch"):
            verify_acceptance_lock(manifest_path="data/manifest.yaml", lock_path=tmp_lock_path)
    finally:
        if tmp_lock_path.exists():
            tmp_lock_path.unlink()


def test_clean_partition_leakage_audit_passes():
    """The default generated partition and lock must pass the comprehensive leakage audit."""
    audit_report = run_leakage_audit(
        manifest_path="data/manifest.yaml",
        partitions_path="data/partitions.json",
        lock_path="data/acceptance.lock",
    )
    assert audit_report["status"] == "PASS"
    assert audit_report["leakage_violations"] == 0


def test_leakage_check_fails_on_document_leakage():
    """Injecting an acceptance document ID into dev must fail."""
    dev_docs = ["doc-001", "doc-002", "doc-003"]
    acc_docs = ["doc-003", "doc-004"]  # doc-003 leaked into dev!

    with pytest.raises(DataLeakageError, match="Document leakage detected"):
        verify_no_document_leakage(dev_docs, acc_docs)


def test_leakage_check_fails_on_page_leakage():
    """Injecting an acceptance page into dev items must fail."""
    dev_pages = ["doc-001_p1", "doc-001_p2", "doc-004_page_3"]  # doc-004 is in acceptance!
    acc_docs = ["doc-004", "doc-008"]

    with pytest.raises(DataLeakageError, match="Page leakage detected"):
        verify_no_page_leakage(dev_pages, acc_docs)


def test_leakage_check_fails_on_derived_artifact_leakage():
    """Injecting a derived artifact from an acceptance document into dev artifacts must fail."""
    dev_artifacts = [
        "embeddings/doc-001_features.npy",
        "cache/seg-doc-003-table_1.json",  # doc-003 is in acceptance!
        "chunks/doc-005_chunk_0.txt",
    ]
    acc_docs = ["doc-003", "doc-004"]

    with pytest.raises(DataLeakageError, match="Derived artifact leakage detected"):
        verify_no_artifact_leakage(dev_artifacts, acc_docs)


def test_extract_doc_id_from_identifier():
    """Verifies regex extraction of root document IDs from diverse artifact patterns."""
    assert extract_doc_id_from_identifier("doc-003_p4") == "doc-003"
    assert extract_doc_id_from_identifier("doc-001_page_12") == "doc-001"
    assert extract_doc_id_from_identifier("seg-doc-007-45") == "doc-007"
    assert extract_doc_id_from_identifier("embeddings/doc-010.npy") == "doc-010"
    assert extract_doc_id_from_identifier("random_text_without_id") is None
