# Retrieva AI — Evidence Layer & Partitioning Plan

> **Document Version:** 1.0.0  
> **Author:** Meghavarshini Prathapani  
> **Status:** Active & Enforced  
> **Scope:** Pre-Modelling Evidence Layer, Provenance Tracking, Frozen Acceptance Partitioning, and Zero-Leakage Governance  

---

## 1. Executive Summary & Foundational Principles

In document understanding and spatial information retrieval systems, **the evidence layer must precede all modeling, feature extraction, and index construction**. Enterprise PDF documents are dense, visually structured artifacts with complex internal cross-references, shared font hierarchies, page continuities, and stylistic fingerprints.

Attempting to evaluate a model on page-level random splits (e.g., placing Page 1 of a financial report in the training/development set and Page 2 in the test set) leads to severe **data contamination and optimistic performance inflation**. Adjacent pages in a document share header geometries, coordinate scales, font dictionaries, tabular schemas, and lexical vocabulary.

To guarantee scientific rigor, Retrieva AI establishes an immutable **Evidence Layer** governed by three core tenets:

1. **Document-Level Partitioning Invariant**: Documents are split strictly as atomic units. All pages, bounding boxes, text chunks, and derived artifacts of any document belong exclusively to either the **Dev** partition or the **Frozen Independent Acceptance** partition.
2. **Deterministic Cryptographic Locking**: The independent acceptance partition is generated using a fixed random seed ($S = 42$) and immediately locked with a SHA-256 cryptographic hash recorded in `data/acceptance.lock`. Any modification to the acceptance partition breaks the lock and fails the build.
3. **Automated Zero-Leakage Auditing**: Automated verification checks enforce mutual exclusion across document IDs, page identifiers, and derived feature artifacts prior to any evaluation or inference.

---

## 2. Document Manifest Specification (`/data/manifest.yaml`)

The authoritative inventory of all document assets is maintained in [`/data/manifest.yaml`](file:///c:/Disk%20D/Capstone/data/manifest.yaml). Every document record tracks provenance, legal custody, visual layout characteristics, modality flags, and downstream KPI mappings.

### 2.1 Manifest Schema Attributes

| Attribute | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `id` | `string` | Unique, permanent document identifier | `"doc-001"` |
| `title` | `string` | Human-readable document filename | `"Annual Financial Report 2025.pdf"` |
| `file_path` | `string` | Relative path to local file | `"data/sample_documents/doc-001.pdf"` |
| `source_url` | `string` | Canonical provenance URL where document was retrieved | `"https://www.sec.gov/edgar/..."` |
| `access_date` | `string` | ISO 8601 date of retrieval/archival | `"2026-09-20"` |
| `licence` | `string` | Statutory or open copyright license | `"Public Domain (US SEC EDGAR)"` |
| `owner_custodian`| `string` | Legal or organizational custodian of the document | `"SEC EDGAR / Enterprise Registrant"` |
| `document_type` | `string` | Genre: financial report, academic paper, form, legal, etc. | `"financial report"` |
| `layout_type` | `string` | Geometric layout: single-column, multi-column, mixed, form-grid | `"multi-column"` |
| `has_tables` | `boolean`| Flag indicating presence of structured tabular grids | `true` |
| `has_formulas` | `boolean`| Flag indicating presence of mathematical equations | `false` |
| `pages_count` | `integer`| Total number of physical pages | `42` |
| `kpi` | `string` | Primary evaluation KPI targeting this document | `"table_extraction_f1"` |
| `description` | `string` | Narrative overview of document contents and challenges | `"Consolidated earnings matrices..."` |

### 2.2 Pre-Modelling Document Inventory

Below is the verified inventory of the initial document set:

| ID | Document Title | Type | Layout | Tables | Formulas | Target KPI | Licence |
| :--- | :--- | :--- | :--- | :---: | :---: | :--- | :--- |
| `doc-001` | Annual Financial Report 2025.pdf | Financial Report | Multi-Column | ✅ | ❌ | `table_extraction_f1` | SEC Public Domain |
| `doc-002` | LayoutLMv3 Multi-Modal Research Paper.pdf | Academic Paper | Multi-Column | ✅ | ✅ | `spatial_bbox_iou` | CC-BY-4.0 |
| `doc-003` | Enterprise Zero-Trust Security Policy.pdf | Compliance Policy | Single-Column | ❌ | ❌ | `text_retrieval_mrr` | NIST Public Domain |
| `doc-004` | Transformer Spatial Attention Architecture.pdf | Technical Whitepaper| Multi-Column | ✅ | ✅ | `spatial_bbox_iou` | CC-BY-NC-SA-4.0 |
| `doc-005` | Quarterly Cloud Revenue & Operations Report.pdf | Financial Report | Mixed | ✅ | ❌ | `table_extraction_f1` | Open Commercial |
| `doc-006` | Corporate W-9 Tax Compliance Form.pdf | Form | Form-Grid | ✅ | ❌ | `form_key_value_f1` | US Gov Works |
| `doc-007` | Master Services Agreement Template.pdf | Legal | Single-Column | ❌ | ❌ | `text_retrieval_mrr` | CC0 Public Domain |
| `doc-008` | DocVQA Visual Question Answering Benchmark.pdf | Academic Paper | Multi-Column | ✅ | ✅ | `visual_qa_anls` | CC-BY-4.0 |
| `doc-009` | Vendor Cyber Risk Questionnaire.pdf | Form | Form-Grid | ✅ | ❌ | `form_key_value_f1` | CISA Public Domain |
| `doc-010` | ESG Environmental Impact Disclosure.pdf | Legal | Single-Column | ✅ | ❌ | `text_retrieval_mrr` | GRI Standard Open |

---

## 3. Partitioning Methodology & Invariants

Partitioning is executed deterministically by [`eval/partition.py`](file:///c:/Disk%20D/Capstone/eval/partition.py) under strict constraints.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          AUTHORITATIVE MANIFEST                             │
│                           [ data/manifest.yaml ]                            │
│                                (10 Documents)                               │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                      Fixed Seed RNG (seed = 42)
                      Document-Level Granularity (No page splitting)
                                       │
                    ┌──────────────────┴──────────────────┐
                    ▼                                     ▼
┌──────────────────────────────────────┐┌─────────────────────────────────────┐
│            DEV PARTITION             ││    INDEPENDENT ACCEPTANCE SPLIT     │
│         [ data/partitions.json ]     ││       [ data/acceptance.lock ]      │
│               70% Split              ││               30% Split             │
│        (7 Whole Documents)           ││          (3 Whole Documents)        │
│ doc-001, doc-002, doc-005, doc-006,  ││       doc-003, doc-004, doc-008    │
│ doc-007, doc-009, doc-010            ││                                     │
│                                      ││ SHA-256 Digest:                     │
│ Target: Training, Layout Tuning,     ││ a5f7bfbcfbe9c39efadaae06c1c481...   │
│ Prompt Eng, FAISS Index Exploration  ││ Target: Unseen Frozen Acceptance    │
└──────────────────────────────────────┘└─────────────────────────────────────┘
```

### 3.1 The Document-Level Granularity Rule

$$\forall d \in \mathcal{D}, \quad \text{Pages}(d) \subset \mathcal{P}_{\text{dev}} \iff d \in \mathcal{D}_{\text{dev}}$$

$$\forall d \in \mathcal{D}, \quad \text{Pages}(d) \subset \mathcal{P}_{\text{acceptance}} \iff d \in \mathcal{D}_{\text{acceptance}}$$

$$\mathcal{D}_{\text{dev}} \cap \mathcal{D}_{\text{acceptance}} = \emptyset$$

Splitting is performed exclusively on whole documents. At no point may pages from document $d$ be distributed across both partitions.

### 3.2 Fixed Seed Determinism ($S = 42$)

To avoid stochastic variance across operating systems or Python runtimes, partitioning performs a deterministic shuffle seeded with $S = 42$:

```python
rng = random.Random(seed)
shuffled_indices = list(range(len(sorted_docs)))
rng.shuffle(shuffled_indices)
```

For the baseline 10-document manifest with a 30% acceptance ratio, this produces:
- **Dev Partition (7 documents)**: `doc-001`, `doc-002`, `doc-005`, `doc-006`, `doc-007`, `doc-009`, `doc-010`
- **Frozen Acceptance Partition (3 documents)**: `doc-003`, `doc-004`, `doc-008`

---

## 4. Cryptographic Acceptance Lock (`data/acceptance.lock`)

To guarantee that the independent acceptance partition remains completely frozen and untouchable throughout experimentation, a cryptographic SHA-256 digest is generated from the canonical serialization of the acceptance documents:

$$\mathcal{H}_{\text{acceptance}} = \text{SHA-256}\Big(\text{CanonicalJSON}\big(\{ \text{acceptance documents metadata} \}\big)\Big)$$

The resulting digest is recorded in [`data/acceptance.lock`](file:///c:/Disk%20D/Capstone/data/acceptance.lock):

```json
{
  "lock_version": "1.0.0",
  "config_version": "1.0.0",
  "seed": 42,
  "acceptance_ratio": 0.3,
  "acceptance_hash": "a5f7bfbcfbe9c39efadaae06c1c4812842ab6e2127af357ce6e183ed5e517bdf",
  "acceptance_document_ids": [
    "doc-003",
    "doc-004",
    "doc-008"
  ],
  "document_count": 3,
  "created_at": "2026-10-28T17:54:08.035775+00:00",
  "status": "FROZEN_LOCKED",
  "description": "FROZEN INDEPENDENT ACCEPTANCE PARTITION LOCK. DO NOT MODIFY MANUALLY."
}
```

### 4.1 Tamper Detection Invariant

During every test execution or evaluation run, [`eval/leakage.py`](file:///c:/Disk%20D/Capstone/eval/leakage.py) recalculates the SHA-256 hash directly from [`data/manifest.yaml`](file:///c:/Disk%20D/Capstone/data/manifest.yaml) and compares it with `acceptance_hash`. If any researcher or script:
- Changes an acceptance document ID
- Modifies a document's layout or source in the manifest
- Alters the lock file itself

The verification engine immediately raises a fatal `DataLeakageError` and halts execution.

---

## 5. Leakage Prevention Guarantees & Enforcement

The leakage verification engine in [`eval/leakage.py`](file:///c:/Disk%20D/Capstone/eval/leakage.py) enforces four layers of defense:

### Layer 1: Document ID Mutual Exclusion
Checks that $\mathcal{D}_{\text{dev}} \cap \mathcal{D}_{\text{acceptance}} = \emptyset$. If any document ID appears in both partitions, `verify_no_document_leakage()` raises `DataLeakageError`.

### Layer 2: Page-Level Entity Boundary
Inspects all page strings (e.g. `doc-003_p1`, `doc-004_page_5`). If any page originating from an acceptance document appears in any dev dataset, training batch, or dev cache, `verify_no_page_leakage()` raises `DataLeakageError`.

### Layer 3: Derived Artifact Boundary
Inspects derived feature artifacts (e.g., embedding files `embeddings/doc-004.npy`, segment caches `cache/seg-doc-008-*.json`, OCR token caches). If any artifact filename or metadata references an acceptance document ID, `verify_no_artifact_leakage()` raises `DataLeakageError`.

### Layer 4: Cryptographic Lock Verification
Verifies that the stored `acceptance_hash` in `data/acceptance.lock` matches the live manifest data, ensuring no stealth alterations have occurred.

---

## 6. Target KPI Alignment Matrix

Each document in the evidence manifest is tied to specific research evaluation benchmarks:

| Target KPI | Metric Definition | Target Milestone | Primary Documents |
| :--- | :--- | :--- | :--- |
| **`table_extraction_f1`** | Harmonic mean of cell coordinate precision and recall | $\ge 92.0\%$ | `doc-001` (Financials), `doc-005` (Operations) |
| **`spatial_bbox_iou`** | Mean Intersection over Union of 2D bounding boxes | $\ge 0.88$ | `doc-002` (LayoutLMv3), `doc-004` (Attention Whitepaper) |
| **`text_retrieval_mrr`** | Mean Reciprocal Rank of first relevant passage | $\ge 0.85$ | `doc-003` (Zero-Trust), `doc-007` (Legal MSA), `doc-010` (ESG) |
| **`form_key_value_f1`** | Entity pair extraction accuracy across form fields | $\ge 90.0\%$ | `doc-006` (W-9 Form), `doc-009` (Risk Questionnaire) |
| **`visual_qa_anls`** | Average Normalized Levenshtein Similarity for DocVQA | $\ge 82.5\%$ | `doc-008` (DocVQA Benchmark) |

---

## 7. Researcher Runbook & CLI Reference

### 7.1 Inspecting the Manifest
```bash
# View all manifest records
python -c "import yaml; print(yaml.safe_load(open('data/manifest.yaml'))['documents'])"
```

### 7.2 Re-Generating Partitions
To re-run the deterministic partitioner (e.g. after adding new documents to the manifest):
```bash
python -m eval.partition --manifest data/manifest.yaml --ratio 0.30 --seed 42
```

### 7.3 Executing the Leakage Audit
To audit the repository for document, page, or artifact leakage:
```bash
python -m eval.leakage
```

### 7.4 Running the Test Suite
All leakage checks and manifest integrity constraints are verified as part of the primary test suite:
```bash
# Run via pytest
pytest tests/test_leakage.py -v

# Run full project verification
make test
```

