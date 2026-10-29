"""Downstream Retrieval Evaluation: Naive Ingestion vs O2 Reference vs O2+O3.

Evaluates:
- hit@1, hit@3, hit@5
- Mean Reciprocal Rank (MRR)
- Answer-Grounding rate
- KPI-3 Scoring Rubric (0-100) and Inter-Rater Agreement (Cohen's Kappa)
- Condition-wise breakdowns (table lookup, formula, multi-column text, etc.)
- 95% Bootstrap Confidence Intervals
"""

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple

import yaml

from backend.extractors.base import BoundingBox, Element, ElementType, FormulaData, TableCell
from backend.layout import LayoutOrderRecovery
from backend.provenance import ProvenanceConfig, ProvenanceSubsystem
from backend.provenance.schema import EnrichedElement
from backend.retrieval import (
    FaissRetriever,
    NaiveFlatChunker,
    StructuredElementChunker,
)
from eval.rate_kpi3 import evaluate_rater_agreement
from eval.retrieval_metrics import (
    compute_aggregate_retrieval_metrics,
    evaluate_retrieval_query,
)


def load_ground_truth_elements(gt_path: Path) -> List[Element]:
    """Load GroundTruthElement records from benchmark JSON and map to Element instances."""
    data = json.loads(gt_path.read_text(encoding="utf-8"))
    page_no = data.get("page_number", 1)
    elements: List[Element] = []

    for raw in data.get("elements", []):
        raw_type = raw.get("type", "text").lower()
        if raw_type == "heading":
            elem_type = ElementType.HEADING
        elif raw_type == "table":
            elem_type = ElementType.TABLE
        elif raw_type == "formula":
            elem_type = ElementType.FORMULA
        elif raw_type == "figure":
            elem_type = ElementType.FIGURE
        else:
            elem_type = ElementType.TEXT

        box_raw = raw.get("bbox", {})
        x = float(box_raw.get("x", 0.0))
        y = float(box_raw.get("y", 0.0))
        w = float(box_raw.get("width", 100.0))
        h = float(box_raw.get("height", 20.0))
        bbox = BoundingBox(x_min=x, y_min=y, x_max=x + w, y_max=y + h)

        table_cells = None
        if elem_type == ElementType.TABLE and "table" in raw:
            table_cells = []
            for c in raw["table"].get("cells", []):
                c_text = str(c.get("content", c.get("text", "")))
                table_cells.append(
                    TableCell(
                        row_index=int(c.get("row_index", 0)),
                        col_index=int(c.get("col_index", 0)),
                        row_span=int(c.get("row_span", 1)),
                        col_span=int(c.get("col_span", 1)),
                        text=c_text,
                        content=c_text,
                        is_header=bool(c.get("is_header", False)),
                    )
                )

        formula_data = None
        if elem_type == ElementType.FORMULA and "formula" in raw:
            f = raw["formula"]
            formula_data = FormulaData(
                latex=f.get("latex", ""),
                text=f.get("text", ""),
                formula_type=f.get("formula_type", "display"),
            )

        elements.append(
            Element(
                type=elem_type,
                page=page_no,
                bbox=bbox,
                reading_order=int(raw.get("reading_order", 0)),
                text=str(raw.get("text", "")),
                table_cells=table_cells,
                formula=formula_data,
                formula_data=formula_data,
                raw_confidence=0.98 if raw.get("is_critical") else 0.92,
                metadata={
                    "id": raw.get("id", f"elem_{raw.get('reading_order', 0)}"),
                    "is_critical": bool(raw.get("is_critical", False)),
                    "critical_category": raw.get("critical_category", ""),
                },
            )
        )

    return elements


def prepare_benchmark_corpus(repo_root: Path) -> Dict[str, Dict[str, Any]]:
    """Load dev documents and their ground truth elements."""
    gt_dir = repo_root / "data" / "benchmarks" / "ground_truth"
    corpus = {}

    for gt_file in sorted(gt_dir.glob("*.json")):
        doc_id = gt_file.stem.split("_")[0]
        pdf_path = repo_root / "data" / "sample_documents" / f"{doc_id}.pdf"
        elements = load_ground_truth_elements(gt_file)
        corpus[doc_id] = {
            "doc_id": doc_id,
            "elements": elements,
            "pdf_path": pdf_path if pdf_path.exists() else None,
        }

    return corpus


def build_pipeline_index(
    pipeline_mode: str,
    corpus: Dict[str, Dict[str, Any]],
) -> Tuple[FaissRetriever, List[Any]]:
    """Build and index chunks for a specific pipeline architecture."""
    all_chunks = []
    layout_recovery = LayoutOrderRecovery()

    for doc_id, doc_data in corpus.items():
        raw_elements = doc_data["elements"]
        pdf_path = doc_data["pdf_path"]

        if pipeline_mode == "Naive_Ingestion":
            # 1. Naive: no layout recovery, tables & formulas flattened to arbitrary character chunks
            chunker = NaiveFlatChunker(chunk_size=320, chunk_overlap=50)
            chunks = chunker.chunk_elements(raw_elements, doc_id=doc_id, file_hash=None)
            all_chunks.extend(chunks)

        elif pipeline_mode == "O2_Reference":
            # 2. O2 Reference: Layout order recovery applied, tables whole, formulas preserved, no provenance/confidence
            ordered_elements = layout_recovery.process(raw_elements)
            chunker = StructuredElementChunker(max_text_chunk_chars=450)
            chunks = chunker.chunk_elements(ordered_elements, doc_id=doc_id, file_hash=None)
            all_chunks.extend(chunks)

        elif pipeline_mode == "O2_Plus_O3":
            # 3. O2 + O3: Layout recovery + full O3 Provenance, SHA-256 hash, Platt confidence, and degraded routing
            ordered_elements = layout_recovery.process(raw_elements)
            subsystem = ProvenanceSubsystem(
                config=ProvenanceConfig(
                    enabled=True,
                    provenance_tracking_enabled=True,
                    calibration_enabled=True,
                    low_confidence_threshold=0.75,
                    critical_scene_strict_threshold=0.85,
                )
            )
            enriched_elements: List[EnrichedElement] = subsystem.process_elements(
                elements=ordered_elements,
                pdf_path=pdf_path or Path(f"{doc_id}.pdf"),
            )
            chunker = StructuredElementChunker(max_text_chunk_chars=450)
            file_hash = enriched_elements[0].provenance.source_file_hash if enriched_elements else None
            chunks = chunker.chunk_elements(enriched_elements, doc_id=doc_id, file_hash=file_hash)
            all_chunks.extend(chunks)

    # Initialize and populate FAISS index
    use_conf = pipeline_mode == "O2_Plus_O3"
    retriever = FaissRetriever(use_confidence_weighting=use_conf)
    retriever.index(all_chunks)

    return retriever, all_chunks


def run_downstream_retrieval_evaluation() -> Path:
    """Execute end-to-end retrieval evaluation comparing Naive vs O2 vs O2+O3."""
    repo_root = Path(__file__).resolve().parent.parent
    questions_file = repo_root / "data" / "questions.yaml"
    with open(questions_file, "r", encoding="utf-8") as f:
        q_data = yaml.safe_load(f)
    questions = q_data.get("questions", [])

    corpus = prepare_benchmark_corpus(repo_root)
    timestamp_str = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")

    pipelines = ["Naive_Ingestion", "O2_Reference", "O2_Plus_O3"]
    evaluation_results: Dict[str, Any] = {
        "timestamp": timestamp_str,
        "benchmark": "downstream_retrieval_evaluation",
        "total_questions": len(questions),
        "corpus_documents": list(corpus.keys()),
        "pipelines": pipelines,
        "pipeline_metrics": {},
        "per_question_results": {},
        "kpi3_inter_rater_agreement": {},
    }

    print("=" * 95, flush=True)
    print(f"[*] Starting Downstream Retrieval Evaluation: {timestamp_str}", flush=True)
    print(f"[*] Evaluating {len(questions)} Questions across {len(corpus)} Documents", flush=True)
    print(f"[*] Pipelines: {', '.join(pipelines)}", flush=True)
    print("=" * 95, flush=True)

    top_chunks_by_pipeline: Dict[str, List[Any]] = {p: [] for p in pipelines}

    for p_name in pipelines:
        print(f"\n[+] Building index for {p_name}...", flush=True)
        retriever, chunks = build_pipeline_index(p_name, corpus)
        print(f"    Indexed {len(chunks)} chunks in FAISS.", flush=True)

        query_evals = []
        latencies_ms = []

        for q in questions:
            t0 = time.perf_counter()
            retrieved = retriever.retrieve(q["query"], top_k=5)
            lat = (time.perf_counter() - t0) * 1000.0
            latencies_ms.append(lat)

            top_chunk = retrieved[0].chunk if retrieved else None
            top_chunks_by_pipeline[p_name].append(top_chunk)

            q_eval = evaluate_retrieval_query(q, retrieved, k_values=[1, 3, 5])
            q_eval["latency_ms"] = round(lat, 2)
            query_evals.append(q_eval)

            # Store per-question detail
            q_id = q["question_id"]
            if q_id not in evaluation_results["per_question_results"]:
                evaluation_results["per_question_results"][q_id] = {
                    "query": q["query"],
                    "question_type": q["question_type"],
                    "expected_answer": q["expected_answer"],
                    "pipeline_runs": {},
                }
            evaluation_results["per_question_results"][q_id]["pipeline_runs"][p_name] = {
                "rank_1_score": retrieved[0].score if retrieved else 0.0,
                "first_hit_rank": q_eval["first_hit_rank"],
                "answer_grounding": q_eval["answer_grounding"],
                "top_chunk_text_preview": top_chunk.text[:120].replace("\n", " ") if top_chunk else "[NONE]",
                "has_provenance": bool(top_chunk.source_file_hash) if top_chunk else False,
            }

        # Aggregate standard retrieval metrics
        agg_metrics = compute_aggregate_retrieval_metrics(query_evals)
        sorted_lats = sorted(latencies_ms)
        p50_lat = sorted_lats[len(sorted_lats) // 2]
        p95_idx = int(0.95 * len(sorted_lats))
        p95_lat = sorted_lats[min(len(sorted_lats) - 1, p95_idx)]

        agg_metrics["latency_p50_ms"] = round(p50_lat, 2)
        agg_metrics["latency_p95_ms"] = round(p95_lat, 2)

        # Evaluate KPI-3 Rubric and Inter-Rater Agreement (Cohen's Kappa)
        kpi3_eval = evaluate_rater_agreement(questions, top_chunks_by_pipeline[p_name])
        agg_metrics["kpi3_summary"] = kpi3_eval

        evaluation_results["pipeline_metrics"][p_name] = agg_metrics

        print(
            f"    -> hit@1: {agg_metrics['hit_at_1']['mean']:.3f} | "
            f"hit@3: {agg_metrics['hit_at_3']['mean']:.3f} | "
            f"MRR: {agg_metrics['mrr']['mean']:.3f} | "
            f"Grounding: {agg_metrics['answer_grounding']['mean']:.3f} | "
            f"KPI-3: {kpi3_eval['mean_kpi3_score']:.1f}/100 (kappa={kpi3_eval['cohens_kappa_quadratically_weighted']:.3f})",
            flush=True,
        )

    # Save JSON results
    results_dir = repo_root / "eval" / "results"
    results_dir.mkdir(parents=True, exist_ok=True)
    out_file = results_dir / f"retrieval_{timestamp_str}.json"
    out_file.write_text(json.dumps(evaluation_results, indent=2), encoding="utf-8")

    # Print Summary Table
    print("\n" + "=" * 95, flush=True)
    print(f"[*] Downstream Retrieval Evaluation Completed! Output: {out_file}", flush=True)
    print("=" * 95, flush=True)

    header = f"{'Pipeline Architecture':<22} | {'hit@1':<8} | {'hit@3':<8} | {'MRR':<8} | {'Grounding':<10} | {'KPI-3 (0-100)':<13} | {'Kappa (w)':<10}"
    print(header)
    print("-" * 95)
    for p_name in pipelines:
        m = evaluation_results["pipeline_metrics"][p_name]
        k = m["kpi3_summary"]
        print(
            f"{p_name:<22} | "
            f"{m['hit_at_1']['mean']:>6.3f}   | "
            f"{m['hit_at_3']['mean']:>6.3f}   | "
            f"{m['mrr']['mean']:>6.3f}   | "
            f"{m['answer_grounding']['mean']:>8.3f}   | "
            f"{k['mean_kpi3_score']:>9.1f}     | "
            f"{k['cohens_kappa_quadratically_weighted']:>8.3f}"
        )
    print("-" * 95)

    return out_file


if __name__ == "__main__":
    run_downstream_retrieval_evaluation()
