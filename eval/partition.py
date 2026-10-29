"""
Retrieva AI — Document Partitioning Script
Splits documents strictly by document (never by page) into dev and a frozen
independent-acceptance partition with a deterministic fixed seed.
Computes and records a cryptographic SHA-256 hash in data/acceptance.lock.
"""

import argparse
import hashlib
import json
import random
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple

import yaml

from backend.app.config import get_settings


def load_manifest(manifest_path: Path | str) -> Dict[str, Any]:
    """Loads and validates the document manifest YAML."""
    manifest_file = Path(manifest_path)
    if not manifest_file.exists():
        raise FileNotFoundError(f"Manifest file not found: {manifest_file}")

    with open(manifest_file, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)

    if not data or "documents" not in data or not isinstance(data["documents"], list):
        raise ValueError(f"Invalid manifest format in {manifest_file}: missing 'documents' list")

    return data


def compute_acceptance_hash(acceptance_docs: List[Dict[str, Any]]) -> str:
    """
    Computes a deterministic cryptographic SHA-256 hash of the acceptance partition.
    Uses canonical JSON serialization (sorted keys, compact separators) for reproducibility.
    """
    canonical_items = []
    for doc in sorted(acceptance_docs, key=lambda d: d["id"]):
        canonical_items.append(
            {
                "id": doc["id"],
                "title": doc.get("title", ""),
                "document_type": doc.get("document_type", ""),
                "layout_type": doc.get("layout_type", ""),
                "source_url": doc.get("source_url", ""),
                "pages_count": doc.get("pages_count", 0),
            }
        )

    serialized = json.dumps(canonical_items, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def split_documents(
    documents: List[Dict[str, Any]],
    acceptance_ratio: float = 0.30,
    seed: int = 42,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Splits documents into dev and acceptance partitions.
    STRICT INVARIANT: Splitting is performed exclusively at the document level,
    never by page. All pages and derived artifacts of a document belong to the same partition.
    """
    if not (0.0 < acceptance_ratio < 1.0):
        raise ValueError(f"acceptance_ratio must be between 0.0 and 1.0, got {acceptance_ratio}")

    if not documents:
        raise ValueError("Cannot partition empty document list")

    # Sort documents by ID to guarantee identical input order across all systems
    sorted_docs = sorted(documents, key=lambda d: str(d["id"]))

    # Use fixed seed RNG for deterministic shuffle
    rng = random.Random(seed)
    shuffled_indices = list(range(len(sorted_docs)))
    rng.shuffle(shuffled_indices)

    # Calculate partition split boundary
    acceptance_count = max(1, round(len(sorted_docs) * acceptance_ratio))

    acceptance_indices = set(shuffled_indices[:acceptance_count])
    dev_indices = set(shuffled_indices[acceptance_count:])

    acceptance_docs = [sorted_docs[i] for i in sorted(acceptance_indices)]
    dev_docs = [sorted_docs[i] for i in sorted(dev_indices)]

    # Invariant verification: mutually exclusive and collectively exhaustive
    dev_ids = {d["id"] for d in dev_docs}
    acc_ids = {d["id"] for d in acceptance_docs}
    assert dev_ids.isdisjoint(acc_ids), "Partitions must be mutually exclusive"
    assert len(dev_ids) + len(acc_ids) == len(sorted_docs), "Partitions must be collectively exhaustive"

    return dev_docs, acceptance_docs


def create_partitions(
    manifest_path: Path | str = "data/manifest.yaml",
    partitions_path: Path | str = "data/partitions.json",
    lock_path: Path | str = "data/acceptance.lock",
    acceptance_ratio: float = 0.30,
    seed: int = 42,
) -> Dict[str, Any]:
    """
    Orchestrates the end-to-end partitioning pipeline:
    1. Loads manifest
    2. Splits documents by document ID (fixed seed)
    3. Computes acceptance SHA-256 hash
    4. Writes partitions.json and acceptance.lock
    """
    settings = get_settings()
    manifest_data = load_manifest(manifest_path)
    documents = manifest_data["documents"]

    dev_docs, acceptance_docs = split_documents(
        documents=documents,
        acceptance_ratio=acceptance_ratio,
        seed=seed,
    )

    acceptance_hash = compute_acceptance_hash(acceptance_docs)
    timestamp = datetime.now(timezone.utc).isoformat()

    dev_ids = sorted(d["id"] for d in dev_docs)
    acc_ids = sorted(d["id"] for d in acceptance_docs)

    partition_payload = {
        "config_version": settings.config_version,
        "seed": seed,
        "acceptance_ratio": acceptance_ratio,
        "total_documents": len(documents),
        "dev_count": len(dev_docs),
        "acceptance_count": len(acceptance_docs),
        "dev_document_ids": dev_ids,
        "acceptance_document_ids": acc_ids,
        "acceptance_hash": acceptance_hash,
        "created_at": timestamp,
    }

    lock_payload = {
        "lock_version": "1.0.0",
        "config_version": settings.config_version,
        "seed": seed,
        "acceptance_ratio": acceptance_ratio,
        "acceptance_hash": acceptance_hash,
        "acceptance_document_ids": acc_ids,
        "document_count": len(acc_ids),
        "created_at": timestamp,
        "status": "FROZEN_LOCKED",
        "description": "FROZEN INDEPENDENT ACCEPTANCE PARTITION LOCK. DO NOT MODIFY MANUALLY.",
    }

    # Persist partitions.json
    p_path = Path(partitions_path)
    p_path.parent.mkdir(parents=True, exist_ok=True)
    with open(p_path, "w", encoding="utf-8") as f:
        json.dump(partition_payload, f, indent=2)

    # Persist acceptance.lock
    l_path = Path(lock_path)
    l_path.parent.mkdir(parents=True, exist_ok=True)
    with open(l_path, "w", encoding="utf-8") as f:
        json.dump(lock_payload, f, indent=2)

    print("\n" + "=" * 65)
    print("      RETRIEVA AI — DOCUMENT PARTITIONING COMPLETE      ")
    print("=" * 65)
    print(f"  Configuration Version : {settings.config_version}")
    print(f"  Fixed Seed            : {seed}")
    print(f"  Total Documents       : {len(documents)}")
    print(f"  Dev Partition (Docs)  : {len(dev_ids)} -> {dev_ids}")
    print(f"  Acceptance Partition  : {len(acc_ids)} -> {acc_ids}")
    print(f"  Acceptance Hash       : {acceptance_hash[:16]}...{acceptance_hash[-8:]}")
    print(f"  Lock File             : {l_path}")
    print("=" * 65 + "\n")

    return partition_payload


def main():
    parser = argparse.ArgumentParser(description="Retrieva AI Document Partitioning Tool")
    parser.add_argument("--manifest", default="data/manifest.yaml", help="Path to manifest.yaml")
    parser.add_argument("--partitions", default="data/partitions.json", help="Output path for partitions.json")
    parser.add_argument("--lock", default="data/acceptance.lock", help="Output path for acceptance.lock")
    parser.add_argument("--ratio", type=float, default=0.30, help="Acceptance split ratio (default 0.30)")
    parser.add_argument("--seed", type=int, default=42, help="Deterministic random seed (default 42)")

    args = parser.parse_args()
    create_partitions(
        manifest_path=args.manifest,
        partitions_path=args.partitions,
        lock_path=args.lock,
        acceptance_ratio=args.ratio,
        seed=args.seed,
    )


if __name__ == "__main__":
    main()
