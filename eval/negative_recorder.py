"""Retrieva AI — Negative Test Suite Recorder & Telemetry Logger.

Captures preconditions, detection assertions, degradation labels, logs,
and recovery timings for NT1 to NT5 and persists results to:
/eval/results/negative_<timestamp>.json
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.app.config import get_settings
from eval.negative_detectors import NegativeAnomalyRecord


class NegativeTestRecorder:
    """Manages recording, structured logging, and JSON persistence for negative test suites."""

    def __init__(self, output_dir: Optional[Path] = None) -> None:
        self.repo_root = Path(__file__).resolve().parent.parent
        self.output_dir = output_dir or (self.repo_root / "eval" / "results")
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.records: Dict[str, NegativeAnomalyRecord] = {}
        self.session_timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        self.logger = logging.getLogger("NegativeTestRecorder")

    def record_case(
        self,
        case_id: str,
        name: str,
        fixture_id: str,
        preconditions: str,
        version: str,
        config: Dict[str, Any],
        expected: Dict[str, Any],
        observed: Dict[str, Any],
        logs: List[str],
        recovery_time_ms: float = 0.0,
    ) -> NegativeAnomalyRecord:
        """Register a test execution record with preconditions and outcome telemetry."""
        record = NegativeAnomalyRecord(
            case_id=case_id,
            name=name,
            fixture_id=fixture_id,
            preconditions=preconditions,
            version=version,
            config=config,
            expected=expected,
            observed=observed,
            logs=logs,
            recovery_time_ms=recovery_time_ms,
        )
        self.records[case_id] = record
        return record

    def save_results(self, timestamp: Optional[str] = None) -> Path:
        """Persist all recorded test cases to /eval/results/negative_<timestamp>.json."""
        ts = timestamp or self.session_timestamp
        target_path = self.output_dir / f"negative_{ts}.json"

        settings = get_settings()
        total = len(self.records)
        passed = sum(1 for r in self.records.values() if r.to_dict()["status"] == "PASS")

        payload = {
            "timestamp": ts,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "config_id": settings.config_id,
            "config_version": settings.config_version,
            "suite_name": "Controlled Negative Anomaly Test Suite (NT1 - NT5)",
            "summary": {
                "total_negative_cases": total,
                "passed_cases": passed,
                "failed_cases": total - passed,
                "all_conditions_detected": all(r.condition_detected for r in self.records.values()),
                "all_abstain_or_degraded": all(r.degraded_or_abstained for r in self.records.values()),
                "all_outputs_labelled": all(r.output_labelled for r in self.records.values()),
                "zero_silent_failures": all(r.nothing_silently_used for r in self.records.values()),
                "status": "PASS" if passed == total and total > 0 else "FAIL",
            },
            "system_versions": {
                "engine": "Retrieva Document Intelligence",
                "extractor": "fitz:1.28.2_pdfplumber:0.11.10",
                "layout_engine": "LayoutOrderRecovery:v1.0.0",
                "provenance_subsystem": "O3:v1.0.0",
                "confidence_calibration": "PlattScaling:MultiSignalFusion",
            },
            "cases": {cid: rec.to_dict() for cid, rec in self.records.items()},
        }

        target_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        return target_path

    @classmethod
    def get_latest_results_file(cls, results_dir: Optional[Path] = None) -> Optional[Path]:
        """Find the newest negative test results JSON file."""
        root = Path(__file__).resolve().parent.parent
        r_dir = results_dir or (root / "eval" / "results")
        files = sorted(r_dir.glob("negative_*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        return files[0] if files else None


# Module-level singleton recorder for tests
_GLOBAL_RECORDER = NegativeTestRecorder()


def get_negative_recorder() -> NegativeTestRecorder:
    """Access the singleton recorder instance."""
    return _GLOBAL_RECORDER

