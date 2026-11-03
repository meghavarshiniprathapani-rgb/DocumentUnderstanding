# Retrieva AI — Backend Testing Report

> **Execution Date:** 2026-11-03T12:46:39Z  
> **Evaluation Lead:** Independent QA Lead & Validation Engineer (AIML-59)  
> **Test Framework:** Pytest 8.3.4 (Python 3.11.9)  
> **Backend Scope:** Ingestion, Geometry, Topology, Calibration, Chunking, Retrieval, APIs  
> **Status:** ALL TESTS PASSED (48 / 48 backend tests, 91 / 91 full suite)  

---

## 1. Backend Subsystem Verification Overview

The backend subsystem comprises the full pipeline from raw PDF byte validation to FAISS spatial-semantic retrieval. Every stage was subjected to automated unit and integration tests.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               BACKEND PIPELINE VERIFIED                                │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 1. Ingestion: Magic bytes check (%PDF), 50MB size guard, 100 pages maximum limit        │
│ 2. Extractor: PdfPlumberExtractor (PyMuPDF fitz + pdfplumber lines & paths)           │
│ 3. Layout: LayoutOrderRecovery (Gutter whitespace analysis, column-first traversal)   │
│ 4. Provenance: SHA-256 digest, spatial coordinates, multi-signal Platt calibration     │
│ 5. Routing: DegradedPathRouter (<0.75 confidence, scrambled order, flattened table)   │
│ 6. Retrieval: StructuredElementChunker + 128d Dense Embedding + FaissRetriever         │
│ 7. API Layer: FastAPI routes (/health, /documents, /search, /evaluation)              │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Backend Test Execution Matrix

| Test ID | Subsystem / Feature | Execution Command | Actual Result | Status | Evidence Location |
| :--- | :--- | :--- | :--- | :---: | :--- |
| **BE-001** | PDF magic byte signature check | `pytest tests/test_api_integration.py -k test_upload_rejects_invalid_magic_bytes` | HTTP 400 with detail "Invalid file content: PDF magic bytes not found" | **PASSED** | [`test_api_integration.py`](file:///d:/DocumentUnderstanding/tests/test_api_integration.py#L65) |
| **BE-002** | File extension validation | `pytest tests/test_api_integration.py -k test_upload_rejects_non_pdf_file_extension` | HTTP 400 with detail "Only PDF documents (.pdf) are supported" | **PASSED** | [`test_api_integration.py`](file:///d:/DocumentUnderstanding/tests/test_api_integration.py#L55) |
| **BE-003** | Max upload file size enforcement (50 MB) | `pytest tests/test_api_integration.py -k test_upload_rejects_oversized_file` | HTTP 413 with detail "exceeds maximum allowed limit of 50 MB" | **PASSED** | [`test_api_integration.py`](file:///d:/DocumentUnderstanding/tests/test_api_integration.py#L85) |
| **BE-004** | Max page count enforcement (100 pages) | `pytest tests/test_api_integration.py -k test_upload_rejects_excessive_page_count` | HTTP 400 with detail "exceeds maximum allowed limit of 100 pages" | **PASSED** | [`test_api_integration.py`](file:///d:/DocumentUnderstanding/tests/test_api_integration.py#L75) |
| **BE-005** | Real PDF extraction and indexing | `pytest tests/test_api_integration.py -k test_upload_valid_pdf_real_extraction_and_indexing` | HTTP 201 Created, DocumentSummary returned with SHA-256 hash | **PASSED** | [`test_api_integration.py`](file:///d:/DocumentUnderstanding/tests/test_api_integration.py#L30) |
| **BE-006** | Element schema & structured types | `pytest tests/test_extractors.py -k test_element_schema_and_structured_types` | Validates BoundingBox, TableCell, FormulaData schemas | **PASSED** | [`test_extractors.py`](file:///d:/DocumentUnderstanding/tests/test_extractors.py#L12) |
| **BE-007** | Extractor factory dispatch | `pytest tests/test_extractors.py -k test_get_extractor_factory` | Returns PdfPlumberExtractor and DoclingExtractor instances | **PASSED** | [`test_extractors.py`](file:///d:/DocumentUnderstanding/tests/test_extractors.py#L28) |
| **BE-008** | PdfPlumber extraction pipeline | `pytest tests/test_extractors.py -k test_pdfplumber_extractor_extracts_placeholder_pdf` | Successfully parses PDF into Element instances with bounding boxes | **PASSED** | [`test_extractors.py`](file:///d:/DocumentUnderstanding/tests/test_extractors.py#L35) |
| **BE-009** | Non-existent file error handling | `pytest tests/test_extractors.py -k test_extractor_raises_on_nonexistent_file` | Raises FileNotFoundError on missing file path | **PASSED** | [`test_extractors.py`](file:///d:/DocumentUnderstanding/tests/test_extractors.py#L52) |
| **BE-010** | Single-column reading order | `pytest tests/test_reading_order.py -k test_one_column_reading_order` | Returns reading_order [0, 1, 2] sorted top-to-bottom | **PASSED** | [`test_reading_order.py`](file:///d:/DocumentUnderstanding/tests/test_reading_order.py#L21) |
| **BE-011** | Two-column reading order vs naive sort | `pytest tests/test_reading_order.py -k test_two_column_reading_order_vs_naive_sort` | POA = 1.0; naive vertical sort fails cross-column reading | **PASSED** | [`test_reading_order.py`](file:///d:/DocumentUnderstanding/tests/test_reading_order.py#L48) |
| **BE-012** | Three-column reading order | `pytest tests/test_reading_order.py -k test_three_column_reading_order` | Preserves left-to-right column progression without interleaving | **PASSED** | [`test_reading_order.py`](file:///d:/DocumentUnderstanding/tests/test_reading_order.py#L78) |
| **BE-013** | Floating sidebar isolation | `pytest tests/test_reading_order.py -k test_floating_sidebar_isolation` | Traverses main text before isolated sidebar block | **PASSED** | [`test_reading_order.py`](file:///d:/DocumentUnderstanding/tests/test_reading_order.py#L107) |
| **BE-014** | Table structure cell adjacency F1 | `pytest tests/test_oracle_metrics.py -k test_table_structure_exact_2x2` | Cell adjacency F1 = 1.0 on 2x2 grid topology | **PASSED** | [`test_oracle_metrics.py`](file:///d:/DocumentUnderstanding/tests/test_oracle_metrics.py#L45) |
| **BE-015** | Table spanning cell geometry | `pytest tests/test_oracle_metrics.py -k test_table_structure_spanning_cell` | Correctly links multi-span cell neighbors | **PASSED** | [`test_oracle_metrics.py`](file:///d:/DocumentUnderstanding/tests/test_oracle_metrics.py#L58) |
| **BE-016** | Formula LaTeX exact & normalized match | `pytest tests/test_oracle_metrics.py -k test_formula_syntactic_normalization_match` | Match score = 1.0 after whitespace and brace normalization | **PASSED** | [`test_oracle_metrics.py`](file:///d:/DocumentUnderstanding/tests/test_oracle_metrics.py#L82) |
| **BE-017** | Formula edit alteration sensitivity | `pytest tests/test_oracle_metrics.py -k test_formula_single_character_alteration` | Score drops to 0.9412 on single character corruption | **PASSED** | [`test_oracle_metrics.py`](file:///d:/DocumentUnderstanding/tests/test_oracle_metrics.py#L93) |
| **BE-018** | SHA-256 provenance record generation | `pytest tests/test_provenance.py -k test_provenance_record_generation` | Attaches 64-char SHA-256 hash, bbox, timestamp, config_id | **PASSED** | [`test_provenance.py`](file:///d:/DocumentUnderstanding/tests/test_provenance.py#L25) |
| **BE-019** | Multi-signal dual agreement & table F1 | `pytest tests/test_provenance.py -k test_dual_extractor_agreement` | Computes IoU agreement and consistency signals across extractors | **PASSED** | [`test_provenance.py`](file:///d:/DocumentUnderstanding/tests/test_provenance.py#L40) |
| **BE-020** | Platt scaling calibration fitting | `pytest tests/test_provenance.py -k test_platt_scaling_and_parameter_fitting` | Logistic scaling parameters fitted, ECE computed | **PASSED** | [`test_provenance.py`](file:///d:/DocumentUnderstanding/tests/test_provenance.py#L75) |
| **BE-021** | Degraded mode routing on uncertainty | `pytest tests/test_provenance.py -k test_degraded_path_routing` | Elements < 0.75 routed to RAW_SLICE_FALLBACK with reasons | **PASSED** | [`test_provenance.py`](file:///d:/DocumentUnderstanding/tests/test_provenance.py#L90) |
| **BE-022** | Structured chunker preserves tables | `pytest tests/test_retrieval.py -k test_structured_element_chunker_preserves_table_whole` | Table chunk preserves markdown grid without line-splitting | **PASSED** | [`test_retrieval.py`](file:///d:/DocumentUnderstanding/tests/test_retrieval.py#L32) |
| **BE-023** | Structured chunker preserves formulas | `pytest tests/test_retrieval.py -k test_structured_element_chunker_preserves_formula_latex` | Preserves display formula LaTeX intact | **PASSED** | [`test_retrieval.py`](file:///d:/DocumentUnderstanding/tests/test_retrieval.py#L48) |
| **BE-024** | 128d dense deterministic embedding | `pytest tests/test_retrieval.py -k test_dense_deterministic_embedding_properties` | Returns unit-normalized 128d vector, identical text produces identical vector | **PASSED** | [`test_retrieval.py`](file:///d:/DocumentUnderstanding/tests/test_retrieval.py#L72) |
| **BE-025** | FAISS retriever ranking and retrieval | `pytest tests/test_retrieval.py -k test_faiss_retriever_ranking_and_retrieval` | Top candidate has highest dot-product score | **PASSED** | [`test_retrieval.py`](file:///d:/DocumentUnderstanding/tests/test_retrieval.py#L88) |
| **BE-026** | Cohen's Kappa quadratic agreement | `pytest tests/test_retrieval.py -k test_cohens_kappa_perfect_agreement` | Returns kappa_w = 1.000 on identical rater vectors | **PASSED** | [`test_retrieval.py`](file:///d:/DocumentUnderstanding/tests/test_retrieval.py#L112) |
| **BE-027** | Search content-type filtering | `pytest tests/test_api_integration.py -k test_search_content_type_filtering` | Filtering by "Table" returns only table chunks | **PASSED** | [`test_api_integration.py`](file:///d:/DocumentUnderstanding/tests/test_api_integration.py#L135) |
| **BE-028** | Search document ID filtering | `pytest tests/test_api_integration.py -k test_search_document_id_filtering` | Filtering by "doc-001" excludes other documents | **PASSED** | [`test_api_integration.py`](file:///d:/DocumentUnderstanding/tests/test_api_integration.py#L148) |
| **BE-029** | Page layout out of bounds 404 | `pytest tests/test_api_integration.py -k test_get_page_layout_out_of_bounds_404` | Requesting page 99 returns HTTP 404 with descriptive detail | **PASSED** | [`test_api_integration.py`](file:///d:/DocumentUnderstanding/tests/test_api_integration.py#L110) |
| **BE-030** | Recovery path configuration reload | `pytest tests/test_api_integration.py -k test_recovery_path_reload_accepted_bundle` | Resets degraded state and restores nominal parameters | **PASSED** | [`test_api_integration.py`](file:///d:/DocumentUnderstanding/tests/test_api_integration.py#L170) |

---

## 3. Backend Test Status Summary

- **Total Backend Tests:** 30 designated target tests (48 tests in backend test suite)
- **Passed:** 30
- **Failed:** 0
- **Blocked:** 0
- **Not Tested:** 0
