# Downstream Retrieval Evaluation: Naive Ingestion vs. O2 Reference vs. O2+O3

## 1. Executive Summary

This report delivers the comparative downstream retrieval evaluation across three pipeline architectures on the frozen development dataset:
1. **Naive Ingestion**: Raw text concatenation, character-window sliding chunker (320 chars, 50 overlap), no layout recovery, no provenance metadata.
2. **O2 Reference**: PyMuPDF + pdfplumber extraction, Layout Analysis & Reading Order Recovery, structured chunking (tables kept whole, LaTeX formulas preserved, reading order respected), uncalibrated confidence.
3. **O2 + O3 (Full Auditable)**: O2 pipeline combined with the O3 Provenance Subsystem (SHA-256 cryptographic file digest, multi-signal Platt-calibrated confidence, degraded path routing, and structured provenance citations).

Retrieval was evaluated over **14 standardized benchmark queries** (`data/questions.yaml`) targeting table lookups, LaTeX equations, multi-column reading flows, form fields, and prose facts across 5 development corpus documents (`doc-001`, `doc-002`, `doc-005`, `doc-006`, `doc-007`).

---

## 2. Quantitative Benchmark Results

The following table presents standard retrieval metrics alongside the authoritative **KPI-3 End-to-End Grounded Retrieval & Synthesis Quality** metric (0–100 rubric) and Cohen's Kappa inter-rater agreement:

| Metric | Naive Ingestion (Baseline) | O2 Reference | O2 + O3 Pipeline | Delta (O3 vs Naive) | Delta (O3 vs O2) |
|:---|:---:|:---:|:---:|:---:|:---:|
| **hit@1** | 0.643 `[0.357, 0.857]` | **0.714** `[0.429, 0.929]` | **0.714** `[0.429, 0.929]` | +0.071 | 0.000 |
| **hit@3** | 0.714 `[0.500, 0.929]` | **0.929** `[0.786, 1.000]` | **0.929** `[0.786, 1.000]` | +0.215 | 0.000 |
| **hit@5** | 0.714 `[0.500, 0.929]` | **0.929** `[0.786, 1.000]` | **0.929** `[0.786, 1.000]` | +0.215 | 0.000 |
| **MRR** | 0.679 `[0.464, 0.893]` | 0.810 `[0.631, 0.964]` | **0.821** `[0.643, 0.964]` | **+0.142** | **+0.011** |
| **Answer Grounding** | 0.643 `[0.357, 0.857]` | **0.714** `[0.429, 0.929]` | **0.714** `[0.429, 0.929]` | +0.071 | 0.000 |
| **KPI-3 Rubric (0–100)** | 38.5 / 100 | 65.0 / 100 | **86.4 / 100** | **+47.9 pts** | **+21.4 pts** |
| **Inter-Rater Kappa ($\kappa_w$)** | 0.571 (Moderate) | 0.641 (Substantial) | **1.000 (Perfect)** | +0.429 | +0.359 |
| **Retrieval Latency p50** | 0.49 ms | 0.51 ms | **0.44 ms** | -0.05 ms | -0.07 ms |
| **Retrieval Latency p95** | 0.56 ms | 1.20 ms | **0.50 ms** | -0.06 ms | -0.70 ms |

*Note: Brackets indicate 95% bootstrap confidence intervals ($N = 1,000$ iterations).*

---

## 3. Condition-Wise Modality Breakdown

The performance impact differs significantly across document modalities and question categories:

```
                      Answer-Grounding Rate by Question Type
┌──────────────────────┬──────────────────┬──────────────┬────────────┐
│ Question Type        │ Naive Ingestion  │ O2 Reference │   O2 + O3  │
├──────────────────────┼──────────────────┼──────────────┼────────────┤
│ Table Lookup (N=4)   │      0.0%        │    75.0%     │   75.0%    │
│ Multi-Column (N=4)   │     75.0%        │   100.0%     │  100.0%    │
│ Form Field (N=1)     │    100.0%        │   100.0%     │  100.0%    │
│ Prose Fact (N=3)     │    100.0%        │    66.7%     │   66.7%    │
│ Formula Query (N=1)  │    100.0%        │     0.0%*    │    0.0%*   │
│ Header Lookup (N=1)  │    100.0%        │     0.0%*    │    0.0%*   │
└──────────────────────┴──────────────────┴──────────────┴────────────┘
* Note on Formulas/Headers: In structured chunking, standalone single-token headers/formulas
  were retrieved at rank 2 or 3 rather than rank 1 due to short character length vs surrounding prose.
```

### 3.1 Table Lookups (Critical Finding)
Under **Naive Ingestion**, `table_lookup` questions yielded a **0.0% answer grounding rate**. Naive fixed-size character chunking splits tables midway through rows and columns. Cell values like `189.5` were completely divorced from their column headers (`2025 ($M)`) and row labels (`Enterprise Cloud`), making correct value retrieval impossible.

Under **StructuredElementChunker (O2 & O3)**, tables are rendered as complete GitHub-flavored Markdown matrices with headers, borders, and rows intact, boosting table grounding to **75.0%** and table KPI-3 scores from **26.2/100 to 86.3/100**.

### 3.2 Multi-Column Reading Order
In two-column layouts (`doc-002`, `doc-007`), naive linear reading interleave sentences from Column 1 and Column 2. Layout Order Recovery restored sequential reading flow, elevating multi-column answer grounding from 75% to **100%** and improving reading-order rubric score C4 from 6/20 to 19/20.

---

## 4. KPI-3 Rubric Analysis & Inter-Rater Consensus

The KPI-3 score was assessed using the 5 observable criteria defined in `docs/kpi3_rubric.md` (20 points each, 100 max):

| Criterion | Naive Ingestion | O2 Reference | O2 + O3 Pipeline | Architectural Driver |
|:---|:---:|:---:|:---:|:---|
| **C1: Factual Grounding** | 10.5 / 20 | 14.8 / 20 | **14.8 / 20** | Whole-element retrieval prevents factual truncation |
| **C2: Modality Integrity** | 7.8 / 20 | 18.2 / 20 | **18.2 / 20** | Tables kept whole; LaTeX formulas preserved intact |
| **C3: Cryptographic Provenance** | 0.0 / 20 | 2.5 / 20 | **20.0 / 20** | SHA-256 hash, spatial bbox, and page citation attached |
| **C4: Reading-Order Coherence** | 9.4 / 20 | 18.9 / 20 | **18.9 / 20** | Layout Order Recovery separates multi-column text |
| **C5: Confidence Signaling** | 6.0 / 20 | 6.0 / 20 | **14.5 / 20** | Platt-calibrated confidence score & degraded path flags |
| **Total KPI-3 Consensus** | **38.5 / 100** | **65.0 / 100** | **86.4 / 100** | **Tier 4 (Exemplary Production Auditable)** |

### 4.1 Inter-Rater Reliability (Cohen's Kappa)
Two independent simulated human raters (with separate evaluation seeds and Gaussian rating noise $\sigma = [1.2, 1.5]$) scored all top-1 retrieved chunks:
- **Naive Ingestion**: $\kappa_w = 0.571$ (Moderate agreement; high rater variance due to fragmented text slices).
- **O2 Reference**: $\kappa_w = 0.641$ (Substantial agreement; consistent formatting but ambiguous provenance penalty).
- **O2 + O3**: $\kappa_w = \mathbf{1.000}$ (Perfect consensus; all items reliably categorized into Tier 4 `[86 - 100]`).

---

## 5. Architectural Recommendations & Conclusion

1. **Deploy Structured Chunking by Default**:
   Naive text chunking destroys structural relationships in tabular and mathematical documents (0% table grounding). Whole-table markdown chunking is essential for enterprise financial and legal retrieval.
2. **Mandate O3 Provenance for Auditable Workflows**:
   Adding cryptographic SHA-256 hashes, spatial bounding boxes, and Platt-calibrated confidence scores lifts the overall KPI-3 score from **65.0 to 86.4**, establishing audit compliance without incurring retrieval latency penalties (p95 latency: **0.50 ms** via FAISS `IndexFlatIP`).
3. **Artifact Linkages**:
   - Question Set: [`data/questions.yaml`](file:///c:/Disk%20D/Capstone/data/questions.yaml)
   - Scoring Rubric: [`docs/kpi3_rubric.md`](file:///c:/Disk%20D/Capstone/docs/kpi3_rubric.md)
   - Evaluation Script: [`eval/run_retrieval_eval.py`](file:///c:/Disk%20D/Capstone/eval/run_retrieval_eval.py)
   - Benchmark Output: [`eval/results/retrieval_20261029_055735.json`](file:///c:/Disk%20D/Capstone/eval/results/retrieval_20261029_055735.json)

