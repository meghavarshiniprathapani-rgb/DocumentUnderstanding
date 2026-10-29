"""Retrieval evaluation metrics: hit@k, MRR, answer-grounding, and bootstrap CIs."""

from typing import Any, Dict, List

from eval.metrics import calculate_bootstrap_ci, calculate_per_condition_breakdowns


def evaluate_retrieval_query(
    query_record: Dict[str, Any],
    retrieved_results: List[Any],
    k_values: List[int] = None,
) -> Dict[str, Any]:
    """Evaluate retrieval results for a single benchmark question.

    Args:
        query_record: Dict containing gold_doc_id, gold_element_id, expected_answer,
                      target_keywords, question_type, etc.
        retrieved_results: Ranked list of RetrievalResult instances.
        k_values: Cutoff k thresholds (defaults to [1, 3, 5]).

    Returns:
        Dictionary of single-query metrics.
    """
    if k_values is None:
        k_values = [1, 3, 5]

    gold_doc = query_record.get("gold_doc_id", "")
    gold_elem_id = query_record.get("gold_element_id", "")
    expected_ans = query_record.get("expected_answer", "").strip().lower()
    target_kws = [kw.lower() for kw in query_record.get("target_keywords", [])]

    # Evaluate whether a chunk is a relevant hit
    def is_hit(chunk: Any) -> bool:
        if getattr(chunk, "source_doc_id", "") != gold_doc:
            return False
        # Matches gold element ID directly
        if gold_elem_id and gold_elem_id in getattr(chunk, "element_ids", []):
            return True
        # Matches expected answer substring
        chunk_text_lower = getattr(chunk, "text", "").lower()
        if expected_ans and expected_ans in chunk_text_lower:
            return True
        # Matches target keywords
        if target_kws and any(kw in chunk_text_lower for kw in target_kws):
            return True
        return False

    # Evaluate answer grounding specifically
    def is_answer_grounded(chunk: Any) -> bool:
        if getattr(chunk, "source_doc_id", "") != gold_doc:
            return False
        chunk_text_lower = getattr(chunk, "text", "").lower()
        if expected_ans and expected_ans in chunk_text_lower:
            return True
        if target_kws and all(kw in chunk_text_lower for kw in target_kws):
            return True
        return False

    first_hit_rank = None
    hits_at_k: Dict[int, bool] = {k: False for k in k_values}

    for idx, res in enumerate(retrieved_results):
        rank = idx + 1
        chunk = res.chunk if hasattr(res, "chunk") else res
        if is_hit(chunk):
            if first_hit_rank is None:
                first_hit_rank = rank
            for k in k_values:
                if rank <= k:
                    hits_at_k[k] = True

    reciprocal_rank = 1.0 / first_hit_rank if first_hit_rank is not None else 0.0

    # Answer grounding evaluated on top-1 chunk
    top1_grounded = False
    if retrieved_results:
        top_chunk = retrieved_results[0].chunk if hasattr(retrieved_results[0], "chunk") else retrieved_results[0]
        top1_grounded = is_answer_grounded(top_chunk)

    return {
        "question_id": query_record.get("question_id", ""),
        "question_type": query_record.get("question_type", "general"),
        "first_hit_rank": first_hit_rank,
        "reciprocal_rank": round(reciprocal_rank, 4),
        "hit_at_1": 1.0 if hits_at_k.get(1, False) else 0.0,
        "hit_at_3": 1.0 if hits_at_k.get(3, False) else 0.0,
        "hit_at_5": 1.0 if hits_at_k.get(5, False) else 0.0,
        "answer_grounding": 1.0 if top1_grounded else 0.0,
    }


def compute_aggregate_retrieval_metrics(
    query_evaluations: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Compute aggregate retrieval benchmarks across all questions with 95% bootstrap CIs.

    Args:
        query_evaluations: List of outputs from evaluate_retrieval_query.

    Returns:
        Aggregate summary dictionary with means, CIs, and condition breakdowns.
    """
    if not query_evaluations:
        return {}

    n = len(query_evaluations)
    hit1_vals = [q["hit_at_1"] for q in query_evaluations]
    hit3_vals = [q["hit_at_3"] for q in query_evaluations]
    hit5_vals = [q["hit_at_5"] for q in query_evaluations]
    mrr_vals = [q["reciprocal_rank"] for q in query_evaluations]
    grounding_vals = [q["answer_grounding"] for q in query_evaluations]

    h1_mean, h1_low, h1_high = calculate_bootstrap_ci(hit1_vals)
    h3_mean, h3_low, h3_high = calculate_bootstrap_ci(hit3_vals)
    h5_mean, h5_low, h5_high = calculate_bootstrap_ci(hit5_vals)
    mrr_mean, mrr_low, mrr_high = calculate_bootstrap_ci(mrr_vals)
    grd_mean, grd_low, grd_high = calculate_bootstrap_ci(grounding_vals)

    # Condition-wise breakdowns across question_type
    breakdown_records = [
        {
            "question_type": q["question_type"],
            "score": q["answer_grounding"],
        }
        for q in query_evaluations
    ]
    type_breakdown = calculate_per_condition_breakdowns(
        breakdown_records,
        condition_keys=["question_type"],
        metric_key="score",
    )

    return {
        "num_queries": n,
        "hit_at_1": {
            "mean": round(h1_mean, 4),
            "ci_95_lower": round(h1_low, 4),
            "ci_95_upper": round(h1_high, 4),
        },
        "hit_at_3": {
            "mean": round(h3_mean, 4),
            "ci_95_lower": round(h3_low, 4),
            "ci_95_upper": round(h3_high, 4),
        },
        "hit_at_5": {
            "mean": round(h5_mean, 4),
            "ci_95_lower": round(h5_low, 4),
            "ci_95_upper": round(h5_high, 4),
        },
        "mrr": {
            "mean": round(mrr_mean, 4),
            "ci_95_lower": round(mrr_low, 4),
            "ci_95_upper": round(mrr_high, 4),
        },
        "answer_grounding": {
            "mean": round(grd_mean, 4),
            "ci_95_lower": round(grd_low, 4),
            "ci_95_upper": round(grd_high, 4),
        },
        "per_condition_breakdown": type_breakdown,
    }

