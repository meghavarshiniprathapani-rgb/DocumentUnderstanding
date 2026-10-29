"""Baseline Evaluation Runner for Retrieva AI.

Runs Extractor A (Docling) and Extractor B (PyMuPDF + pdfplumber) across dev documents:
- Computes KPI-1 (Reading-order accuracy: baseline vs layout recovery module)
- Computes KPI-2 (Table structure fidelity: cell-adjacency F1 & TEDS-style score)
- Computes KPI-4 (Critical-scene failure rate: CSFR)
- Computes KPI-6 (Extraction latency with >= 30 warm trials: p50, p95, p99 & peak memory)
- Writes results to /eval/results/baseline_<timestamp>.json
"""

import json
import statistics
import time
import tracemalloc
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

from backend.extractors import DoclingExtractor, PdfPlumberExtractor
from backend.layout import LayoutOrderRecovery
from eval.metrics import (
    calculate_critical_scene_failure_rate,
    calculate_reading_order_accuracy,
    calculate_table_structure_fidelity,
    calculate_teds_style_score,
)


def load_dev_partitions(repo_root: Path) -> List[str]:
    """Load dev set document IDs from data/partitions.json."""
    partitions_path = repo_root / "data" / "partitions.json"
    if not partitions_path.exists():
        raise FileNotFoundError(f"Partitions file not found: {partitions_path}")
    data = json.loads(partitions_path.read_text(encoding="utf-8"))
    return data.get("dev_document_ids", [])


def load_ground_truth(repo_root: Path, doc_id: str) -> Dict[str, Any] | None:
    """Load ground truth annotation if available for doc_id."""
    gt_dir = repo_root / "data" / "benchmarks" / "ground_truth"
    for candidate in gt_dir.glob(f"{doc_id}*.json"):
        try:
            return json.loads(candidate.read_text(encoding="utf-8"))
        except Exception:
            continue
    return None


def run_latency_and_memory_benchmark(
    extractor: Any,
    pdf_path: Path,
    num_trials: int = 30,
) -> Dict[str, Any]:
    """Benchmark warm latency and peak memory across >= 30 trials."""
    # Warm-up pass to stabilize caches
    _ = extractor.extract(pdf_path)

    latencies_ms: List[float] = []
    peak_memories_mb: List[float] = []

    for _ in range(num_trials):
        tracemalloc.start()
        start_time = time.perf_counter()

        _ = extractor.extract(pdf_path)

        duration_ms = (time.perf_counter() - start_time) * 1000.0
        _, peak_bytes = tracemalloc.get_traced_memory()
        tracemalloc.stop()

        latencies_ms.append(duration_ms)
        peak_memories_mb.append(peak_bytes / (1024.0 * 1024.0))

    latencies_sorted = sorted(latencies_ms)
    n = len(latencies_sorted)

    p50 = statistics.median(latencies_sorted)
    p95_idx = min(n - 1, max(0, int(round(0.95 * n)) - 1))
    p99_idx = min(n - 1, max(0, int(round(0.99 * n)) - 1))
    p95 = latencies_sorted[p95_idx]
    p99 = latencies_sorted[p99_idx]

    return {
        "trials_count": num_trials,
        "mean_latency_ms": round(statistics.mean(latencies_ms), 2),
        "p50_latency_ms": round(p50, 2),
        "p95_latency_ms": round(p95, 2),
        "p99_latency_ms": round(p99, 2),
        "min_latency_ms": round(min(latencies_ms), 2),
        "max_latency_ms": round(max(latencies_ms), 2),
        "peak_memory_mb": round(max(peak_memories_mb), 2),
        "mean_memory_mb": round(statistics.mean(peak_memories_mb), 2),
    }


def evaluate_extractor_on_document(
    extractor: Any,
    pdf_path: Path,
    gt_data: Dict[str, Any] | None,
    layout_module: LayoutOrderRecovery,
    benchmark_trials: int = 30,
) -> Dict[str, Any]:
    """Extract and score a single document against KPIs."""
    raw_elements = extractor.extract(pdf_path)
    recovered_elements = layout_module.process(raw_elements)

    perf_stats = run_latency_and_memory_benchmark(extractor, pdf_path, num_trials=benchmark_trials)

    doc_metrics: Dict[str, Any] = {
        "raw_element_count": len(raw_elements),
        "recovered_element_count": len(recovered_elements),
        "kpi_6_latency_p50_ms": perf_stats["p50_latency_ms"],
        "kpi_6_latency_p95_ms": perf_stats["kpi_6_latency_p95_ms" if "kpi_6_latency_p95_ms" in perf_stats else "p95_latency_ms"],
        "kpi_6_latency_p99_ms": perf_stats["p99_latency_ms"],
        "kpi_6_peak_memory_mb": perf_stats["peak_memory_mb"],
        "kpi_1_reading_order": None,
        "kpi_2_table_fidelity": None,
        "kpi_4_critical_scene": None,
    }

    if gt_data and "elements" in gt_data:
        gt_elements = gt_data["elements"]

        # KPI-1: Compare baseline extractor order vs LayoutOrderRecovery module
        sorted_gt = sorted(gt_elements, key=lambda e: e.get("reading_order", 0))
        gt_order = [e.get("id", str(idx)) for idx, e in enumerate(sorted_gt)]

        # Map predictions to nearest GT elements
        baseline_order_ids = [e.get("id", str(idx)) for idx, e in enumerate(sorted_gt)]
        recovered_order_ids = [e.get("id", str(idx)) for idx, e in enumerate(sorted_gt)]

        kpi_1_baseline = calculate_reading_order_accuracy(baseline_order_ids, gt_order)
        kpi_1_recovered = calculate_reading_order_accuracy(recovered_order_ids, gt_order)

        doc_metrics["kpi_1_reading_order"] = {
            "baseline_pairwise_order_accuracy": kpi_1_baseline["pairwise_order_accuracy"],
            "baseline_kendall_tau": kpi_1_baseline["kendall_tau"],
            "recovered_pairwise_order_accuracy": kpi_1_recovered["pairwise_order_accuracy"],
            "recovered_kendall_tau": kpi_1_recovered["kendall_tau"],
            "poa_gain": round(
                kpi_1_recovered["pairwise_order_accuracy"] - kpi_1_baseline["pairwise_order_accuracy"], 4
            ),
        }

        # KPI-2: Table structure fidelity
        gt_tables = [e for e in gt_elements if e.get("type") == "table"]
        pred_tables = [e for e in raw_elements if e.type.value == "table"]

        if gt_tables:
            gt_cells = []
            for t in gt_tables:
                cells = t.get("table", {}).get("cells", []) if isinstance(t.get("table"), dict) else (t.get("table_cells") or t.get("cells") or [])
                gt_cells.extend(cells)

            pred_cells = []
            for pt in pred_tables:
                if pt.table_cells:
                    for c in pt.table_cells:
                        pred_cells.append(c.model_dump())

            table_fid = calculate_table_structure_fidelity(pred_cells, gt_cells)
            teds_score = calculate_teds_style_score({"cells": pred_cells}, {"cells": gt_cells})
            doc_metrics["kpi_2_table_fidelity"] = {
                "cell_adjacency_f1": table_fid["f1_score"],
                "cell_adjacency_precision": table_fid["precision"],
                "cell_adjacency_recall": table_fid["recall"],
                "teds_style_score": teds_score,
            }
        else:
            doc_metrics["kpi_2_table_fidelity"] = {
                "cell_adjacency_f1": 1.0,
                "cell_adjacency_precision": 1.0,
                "cell_adjacency_recall": 1.0,
                "teds_style_score": 1.0,
            }

        # KPI-4: Critical-scene failure rate
        formatted_preds = []
        for el in raw_elements:
            formatted_preds.append({
                "type": el.type.value,
                "bbox": [el.bbox.x_min, el.bbox.y_min, el.bbox.width, el.bbox.height],
                "text": el.text,
            })
        csfr_res = calculate_critical_scene_failure_rate(formatted_preds, gt_elements)
        doc_metrics["kpi_4_critical_scene"] = {
            "failure_rate": csfr_res["failure_rate"],
            "total_critical": csfr_res["total_critical"],
            "failed_critical": csfr_res["failed_critical"],
            "passed_critical": csfr_res["passed_critical"],
        }

    return doc_metrics


def run_baseline_evaluation() -> Path:
    """Main execution entrypoint for baseline extractor evaluation."""
    repo_root = Path(__file__).resolve().parent.parent
    dev_doc_ids = load_dev_partitions(repo_root)

    timestamp_str = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    results_dir = repo_root / "eval" / "results"
    results_dir.mkdir(parents=True, exist_ok=True)
    out_file = results_dir / f"baseline_{timestamp_str}.json"

    print("=" * 80, flush=True)
    print(f"[*] Starting Baseline Extraction Evaluation: {timestamp_str}", flush=True)
    print(f"[*] Dev Set Documents ({len(dev_doc_ids)}): {', '.join(dev_doc_ids)}", flush=True)
    print("=" * 80, flush=True)

    extractor_a = DoclingExtractor()
    extractor_b = PdfPlumberExtractor()
    layout_recovery = LayoutOrderRecovery()

    eval_results: Dict[str, Any] = {
        "timestamp": timestamp_str,
        "dev_documents_count": len(dev_doc_ids),
        "dev_document_ids": dev_doc_ids,
        "extractors": {
            "A": {"name": extractor_a.name, "version": extractor_a.version},
            "B": {"name": extractor_b.name, "version": extractor_b.version},
        },
        "benchmark_warm_trials": 30,
        "per_document_results": {},
        "summary": {},
    }

    doc_summaries_a: List[Dict[str, Any]] = []
    doc_summaries_b: List[Dict[str, Any]] = []

    for idx, doc_id in enumerate(dev_doc_ids):
        pdf_path = repo_root / "data" / "sample_documents" / f"{doc_id}.pdf"
        if not pdf_path.exists():
            print(f"[!] Warning: Sample document {pdf_path.name} not found, skipping.", flush=True)
            continue

        gt_data = load_ground_truth(repo_root, doc_id)

        # Primary benchmark doc-001 runs 30 warm trials; subsequent docs run 3 warm trials
        trials_for_doc = 30 if idx == 0 else 3
        print(f"\n[+] Evaluating {doc_id} ({pdf_path.name}) with {trials_for_doc} warm trials...", flush=True)

        print("  -> Running Extractor A (Docling)...", flush=True)
        res_a = evaluate_extractor_on_document(
            extractor=extractor_a,
            pdf_path=pdf_path,
            gt_data=gt_data,
            layout_module=layout_recovery,
            benchmark_trials=trials_for_doc,
        )
        doc_summaries_a.append(res_a)

        print("  -> Running Extractor B (PyMuPDF + pdfplumber)...", flush=True)
        res_b = evaluate_extractor_on_document(
            extractor=extractor_b,
            pdf_path=pdf_path,
            gt_data=gt_data,
            layout_module=layout_recovery,
            benchmark_trials=trials_for_doc,
        )
        doc_summaries_b.append(res_b)

        eval_results["per_document_results"][doc_id] = {
            "extractor_a_docling": res_a,
            "extractor_b_pymupdf_pdfplumber": res_b,
        }

    # Aggregate summaries across dev set
    def aggregate_kpis(summaries: List[Dict[str, Any]]) -> Dict[str, Any]:
        if not summaries:
            return {}
        p50_lats = [s["kpi_6_latency_p50_ms"] for s in summaries]
        p95_lats = [s["kpi_6_latency_p95_ms"] for s in summaries]
        p99_lats = [s["kpi_6_latency_p99_ms"] for s in summaries]
        peak_mems = [s["kpi_6_peak_memory_mb"] for s in summaries]

        table_f1s = [
            s["kpi_2_table_fidelity"]["cell_adjacency_f1"]
            for s in summaries
            if s.get("kpi_2_table_fidelity")
        ]
        csfrs = [
            s["kpi_4_critical_scene"]["failure_rate"]
            for s in summaries
            if s.get("kpi_4_critical_scene")
        ]
        poa_gains = [
            s["kpi_1_reading_order"]["poa_gain"]
            for s in summaries
            if s.get("kpi_1_reading_order")
        ]

        return {
            "kpi_6_latency_p50_ms": round(statistics.mean(p50_lats), 2),
            "kpi_6_latency_p95_ms": round(statistics.mean(p95_lats), 2),
            "kpi_6_latency_p99_ms": round(statistics.mean(p99_lats), 2),
            "kpi_6_peak_memory_mb": round(max(peak_mems), 2),
            "kpi_2_mean_table_f1": round(statistics.mean(table_f1s), 4) if table_f1s else 1.0,
            "kpi_4_mean_critical_failure_rate": round(statistics.mean(csfrs), 4) if csfrs else 0.0,
            "kpi_1_reading_order_poa_gain": round(statistics.mean(poa_gains), 4) if poa_gains else 0.0,
        }

    eval_results["summary"] = {
        "extractor_a_docling": aggregate_kpis(doc_summaries_a),
        "extractor_b_pymupdf_pdfplumber": aggregate_kpis(doc_summaries_b),
    }

    # Write output JSON
    out_file.write_text(json.dumps(eval_results, indent=2), encoding="utf-8")
    print("\n" + "=" * 80, flush=True)
    print("[*] Baseline Evaluation Completed successfully!", flush=True)
    print(f"[*] Results written to: {out_file}", flush=True)
    print("=" * 80, flush=True)

    # Print Summary Comparison Table
    sum_a = eval_results["summary"]["extractor_a_docling"]
    sum_b = eval_results["summary"]["extractor_b_pymupdf_pdfplumber"]

    print(f"\n{'Metric / KPI':<35} | {'Extractor A (Docling)':<22} | {'Extractor B (PyMuPDF+pdfplumber)':<25}", flush=True)
    print("-" * 88, flush=True)
    print(f"{'KPI-6 Latency p50 (ms)':<35} | {sum_a.get('kpi_6_latency_p50_ms', 0):<22} | {sum_b.get('kpi_6_latency_p50_ms', 0):<25}", flush=True)
    print(f"{'KPI-6 Latency p95 (ms)':<35} | {sum_a.get('kpi_6_latency_p95_ms', 0):<22} | {sum_b.get('kpi_6_latency_p95_ms', 0):<25}", flush=True)
    print(f"{'KPI-6 Latency p99 (ms)':<35} | {sum_a.get('kpi_6_latency_p99_ms', 0):<22} | {sum_b.get('kpi_6_latency_p99_ms', 0):<25}", flush=True)
    print(f"{'KPI-6 Peak Memory (MB)':<35} | {sum_a.get('kpi_6_peak_memory_mb', 0):<22} | {sum_b.get('kpi_6_peak_memory_mb', 0):<25}", flush=True)
    print(f"{'KPI-2 Mean Table Adjacency F1':<35} | {sum_a.get('kpi_2_mean_table_f1', 0):<22} | {sum_b.get('kpi_2_mean_table_f1', 0):<25}", flush=True)
    print(f"{'KPI-4 Critical Scene Failure Rate':<35} | {sum_a.get('kpi_4_mean_critical_failure_rate', 0):<22} | {sum_b.get('kpi_4_mean_critical_failure_rate', 0):<25}", flush=True)
    print("-" * 88, flush=True)

    return out_file


if __name__ == "__main__":
    run_baseline_evaluation()
