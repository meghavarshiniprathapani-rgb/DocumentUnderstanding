# KPI-3 Scoring Rubric: End-to-End Grounded Retrieval & Synthesis Quality

## 1. Overview & Objective

**KPI-3** evaluates the end-to-end grounded retrieval quality and audit readiness of Retrieva AI. It quantifies how faithfully downstream retrieval retrieves, preserves, and cites multi-modal document structures (tables, formulas, multi-column flows, and cryptographic provenance) to answer domain queries.

The score is rated on an absolute scale from **0 to 100 points**, assessed across **five observable, orthogonal criteria** (20 points each).

---

## 2. Observable Scoring Criteria (0–100 Points Total)

| Criterion | Max Pts | Observable Description |
|:---|:---:|:---|
| **C1. Factual Grounding & Veracity** | 20 | Top retrieved chunk contains the exact, uncorrupted ground-truth facts required to answer the query. Zero extrapolation or out-of-document hallucination. |
| **C2. Structural Modality Preservation** | 20 | **Tables** remain whole with headers and cell alignment intact (not sliced arbitrarily). **Formulas** retain valid LaTeX syntax and operators (e.g. `\frac`, `\sqrt`, `\text{Attention}`). |
| **C3. Cryptographic Provenance & Citation** | 20 | Retrieved chunk is backed by a verifiable SHA-256 source file hash, exact page number, spatial bounding box `[x_min, y_min, width, height]`, and extractor version. |
| **C4. Reading-Order & Layout Coherence** | 20 | Multi-column prose, sidebars, and running headers follow the human logical reading order without cross-column textual interleaving. |
| **C5. Confidence & Degraded-State Signaling** | 20 | Elements near ambiguity thresholds carry calibrated confidence scores. Distorted or partial inputs are transparently flagged with degraded-path status rather than silent errors. |

---

## 3. Named Anchors

### Anchor 0 — Complete Retrieval Failure / Unanchored Hallucination (0 Pts)
- **C1 (0/20)**: Retrieved chunk is from an incorrect document or contains contradictory information.
- **C2 (0/20)**: Tables are destroyed or fragmented into orphan text fragments; formulas are missing or stripped of math operators.
- **C3 (0/20)**: No provenance metadata, missing document ID, no bounding box, no file hash.
- **C4 (0/20)**: Severe reading order interleaving; sentences from column 1 and column 2 are randomly interleaved.
- **C5 (0/20)**: High false confidence reported on corrupted or hallucinated text.

### Anchor 50 — Partial Retrieval / Severe Structural Fragmentation (50 Pts)
- **C1 (12/20)**: Top chunk contains relevant keywords, but the specific target numerical value or clause is clipped or displaced.
- **C2 (8/20)**: Table is split across multiple chunks with lost column headers; formula operators are mangled or converted to raw ASCII approximation.
- **C3 (10/20)**: Basic document title and page number are present, but spatial bounding box is absent and file hash is missing.
- **C4 (10/20)**: Standard single-column text is coherent, but multi-column blocks exhibit order anomalies.
- **C5 (10/20)**: Default confidence score displayed without calibration; degraded extractions are not flagged.

### Anchor 80 — Production Competent / Minor Audit Gap (80 Pts)
- **C1 (18/20)**: Retrieved evidence directly answers the query with high precision and accurate context.
- **C2 (17/20)**: Table is preserved in whole Markdown format; formulas retain correct LaTeX representation with minor whitespace differences.
- **C3 (15/20)**: Page number, bounding box, and document hash are present, but sub-element parentage or extractor version is omitted.
- **C4 (15/20)**: Two-column and three-column reading order recovered cleanly; minor delay in sidebar attachment.
- **C5 (15/20)**: Calibrated confidence score attached; low-confidence elements are flagged, though fallback metadata is brief.

### Anchor 100 — Flawless Cryptographic Grounding & Modality Integrity (100 Pts)
- **C1 (20/20)**: Exact ground-truth fact retrieved in rank-1 chunk with zero extraneous noise or truncation.
- **C2 (20/20)**: Complete table preserved with headers, row spans, column spans, and markdown grid; LaTeX formulas are syntactically and semantically pristine.
- **C3 (20/20)**: Full audit trail: SHA-256 source hash, 1-indexed page, normalized float bounding box `[x_min, y_min, width, height]`, extractor identity, and config ID.
- **C4 (20/20)**: Flawless layout recovery across multi-column, floating sidebars, headers, and footers.
- **C5 (20/20)**: Multi-signal calibrated confidence (ECE < 0.02); degraded elements routed with explicit fallback strategy tags.

---

## 4. Instructions for Independent Raters

To ensure scientific objectivity and reproducibility, human evaluation of KPI-3 must follow these strict operational rules:

1. **Independent Blinding**:
   - Each rater must score retrieval outputs independently without communicating with the other rater.
   - System outputs must be anonymized (labeled as `Pipeline_A`, `Pipeline_B`, `Pipeline_C`) so raters do not know whether a result came from Naive Ingestion, O2 Reference, or O2+O3.
2. **Scoring Process**:
   - For each query in `/data/questions.yaml`, inspect the top-1 retrieved chunk, its metadata, and its citations against the ground truth document.
   - Assign integer points for each criterion (C1 to C5, 0–20 each) and sum for the total question score (0–100).
3. **Discrepancy Adjudication**:
   - If $| \text{Score}_{\text{Rater 1}} - \text{Score}_{\text{Rater 2}} | > 15$, an adjudication conference is triggered with an independent third rater to establish consensus.
4. **Inter-Rater Agreement Metric**:
   - Cohen's Kappa ($\kappa$) is computed over four standard performance tiers:
     - Tier 1: `[0 - 40]` (Unusable / Deficient)
     - Tier 2: `[41 - 70]` (Marginal / Degraded)
     - Tier 3: `[71 - 85]` (Production Competent)
     - Tier 4: `[86 - 100]` (Exemplary / Fully Auditable)
   - Benchmark target: $\kappa \ge 0.75$ (substantial agreement).

$$\kappa = \frac{P_o - P_e}{1 - P_e}$$
where $P_o$ is relative observed agreement and $P_e$ is hypothetical probability of chance agreement.

