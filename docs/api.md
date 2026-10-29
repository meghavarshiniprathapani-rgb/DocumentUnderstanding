# Retrieva AI — REST API Reference Manual

The Retrieva AI backend service exposes a RESTful API powered by **FastAPI**. All response bodies follow a consistent `BaseResponse[T]` wrapper, and endpoints are prefixed with `/api/v1`.

- **Base URL**: `http://localhost:8000/api/v1`
- **Interactive OpenAPI Documentation**: `http://localhost:8000/docs`
- **ReDoc Documentation**: `http://localhost:8000/redoc`

---

## 1. Global Response Envelope Schema

Every response conforms to the generic schema:

```json
{
  "config_version": "1.0.0",
  "status": "success | error",
  "message": "Human-readable status summary",
  "data": { ... } | null,
  "timestamp": "2026-10-29T10:20:00.000000+00:00"
}
```

### HTTP Headers
Every response includes:
- `X-Config-Version`: Active immutable configuration identifier (`1.0.0`).
- `X-Process-Time-Ms`: Processing duration in milliseconds.

---

## 2. System Endpoints

### 2.1 Root Discovery
- **`GET /`**
- **Description**: Returns root discovery links and active service metadata.
- **Example Response (200 OK)**:
  ```json
  {
    "config_version": "1.0.0",
    "status": "success",
    "message": "Welcome to Retrieva AI Document Understanding Engine",
    "data": {
      "service": "Retrieva AI Document Understanding Engine",
      "docs": "/docs",
      "api_v1": "/api/v1",
      "health": "/api/v1/health"
    },
    "timestamp": "2026-10-29T10:20:00.000000+00:00"
  }
  ```

---

### 2.2 System Health & Telemetry
- **`GET /api/v1/health`**
- **Description**: Exposes `/metrics`-style operational telemetry: active model versions, index dimensions, memory footprint, uptime, and degraded-mode status.
- **Example Response (200 OK)**:
  ```json
  {
    "config_version": "1.0.0",
    "status": "success",
    "message": "Retrieva AI engine is fully operational",
    "data": {
      "service": "Retrieva AI Document Understanding Engine",
      "status": "healthy",
      "environment": "development",
      "config_version": "1.0.0",
      "config_id": "O3-v1.0.0",
      "model_versions": {
        "extractor": "PyMuPDF_pdfplumber:fitz:1.28.2_pdfplumber:0.11.10",
        "embedding": "DenseDeterministicEmbedding:128d:seed42",
        "layout_engine": "LayoutOrderRecovery:v1.0.0",
        "provenance_subsystem": "O3:O3-v1.0.0"
      },
      "index_size": 13,
      "documents_count": 3,
      "degraded_mode_active": false,
      "last_error": null,
      "uptime_seconds": 128.45,
      "memory_usage_mb": 0.04,
      "ocr_engine": "pymupdf_pdfplumber",
      "vector_db": "faiss",
      "confidence_threshold": 0.75,
      "max_upload_size_mb": 50,
      "max_pages_per_document": 100
    },
    "timestamp": "2026-10-29T10:20:01.000000+00:00"
  }
  ```

---

### 2.3 System Recovery & Bundle Reload
- **`POST /api/v1/health/reload`**
- **Description**: Reloads the accepted configuration bundle, resets degraded flags, and rebuilds the FAISS index from the verified baseline corpus.
- **Example Response (200 OK)**:
  ```json
  {
    "config_version": "1.0.0",
    "status": "success",
    "message": "Accepted model/config bundle reloaded. Degraded mode reset.",
    "data": {
      "status": "success",
      "message": "Accepted model and configuration bundle reloaded successfully.",
      "config_id": "O3-v1.0.0",
      "config_version": "1.0.0",
      "reindexed_chunks": 13,
      "degraded_mode_active": false
    },
    "timestamp": "2026-10-29T10:20:02.000000+00:00"
  }
  ```

---

## 3. Document Management Endpoints

### 3.1 List Documents
- **`GET /api/v1/documents`**
- **Description**: Returns summary records of all registered documents in the repository.
- **Example Response (200 OK)**:
  ```json
  {
    "config_version": "1.0.0",
    "status": "success",
    "message": "Retrieved 3 documents",
    "data": [
      {
        "document_id": "doc-003",
        "title": "DOC-003_COMPLIANCE_POLICY.pdf",
        "category": "Compliance Policy",
        "file_size": "2.4 MB",
        "pages_count": 1,
        "status": "Processed",
        "parsing_accuracy": 98.8,
        "metrics": {
          "text_blocks": 4,
          "tables": 0,
          "figures": 0,
          "headings": 1
        },
        "uploaded_at": "2026-10-28",
        "file_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "is_degraded": false
      }
    ],
    "timestamp": "2026-10-29T10:20:03.000000+00:00"
  }
  ```

---

### 3.2 Get Document Detail
- **`GET /api/v1/documents/{document_id}`**
- **Parameters**: `document_id` (Path, string, e.g. `doc-004`).
- **Status Codes**: `200 OK` on success, `404 Not Found` if document ID does not exist.

---

### 3.3 Upload & Ingest PDF Document
- **`POST /api/v1/documents/upload`**
- **Content-Type**: `multipart/form-data`
- **Form Fields**:
  - `file`: Binary PDF file stream.
  - `category`: (Optional) String category label (e.g. `Financial Report`, `Technical Whitepaper`).
- **Validation Rules**:
  - File extension must be `.pdf` (HTTP 400 if violated).
  - Magic bytes must start with `%PDF-` (HTTP 415 if violated).
  - File size must not exceed $50\text{ MB}$ (HTTP 413 if violated).
  - Page count must not exceed $100$ pages (HTTP 422 if violated).
- **Processing Flow**:
  1. Computes SHA-256 hash of uploaded bytes.
  2. Extracts text, tables, and formulas using `PdfPlumberExtractor`.
  3. Recovers multi-column reading order via `LayoutOrderRecovery`.
  4. Attaches cryptographic audit records and calibrated confidence via `ProvenanceSubsystem`.
  5. Chunks structured elements and updates the live FAISS index.
- **Example Response (200 OK)**:
  ```json
  {
    "config_version": "1.0.0",
    "status": "success",
    "message": "Document uploaded and indexed successfully",
    "data": {
      "document_id": "doc-upload-a1b2c3d4",
      "title": "annual_filing_2026.pdf",
      "category": "Financial Report",
      "file_size": "1.82 MB",
      "pages_count": 3,
      "status": "Processed",
      "parsing_accuracy": 98.4,
      "metrics": {
        "text_blocks": 24,
        "tables": 3,
        "figures": 1,
        "headings": 5
      },
      "uploaded_at": "2026-10-29",
      "file_hash": "7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b",
      "is_degraded": false
    },
    "timestamp": "2026-10-29T10:20:05.000000+00:00"
  }
  ```

---

### 3.4 Get Page Layout Segments & Provenance
- **`GET /api/v1/documents/{document_id}/pages/{page_number}`**
- **Parameters**:
  - `document_id`: Path, string.
  - `page_number`: Path, integer (1-indexed).
- **Description**: Returns all 2D bounding boxes, reading order sequence, structured table cells, LaTeX formulas, and cryptographic provenance records for rendering on the PDF canvas viewer.
- **Example Response (200 OK)**:
  ```json
  {
    "config_version": "1.0.0",
    "status": "success",
    "message": "Retrieved 7 segments for page 1",
    "data": [
      {
        "segment_id": "seg-doc-004-405",
        "element_id": "elem-405",
        "type": "formula",
        "text": "Bias(i, j) = b_x(x_i - x_j) + b_y(y_i - y_j)",
        "reading_order": 3,
        "bbox": {
          "x": 50.0,
          "y": 330.0,
          "width": 460.0,
          "height": 65.0
        },
        "raw_confidence": 0.98,
        "calibrated_confidence": 0.962,
        "confidence_method": "Platt Scaling (Multi-Signal)",
        "formula": {
          "latex": "\\text{Bias}(i, j) = \\mathbf{b}_{x}(x_i - x_j) + \\mathbf{b}_{y}(y_i - y_j)",
          "formula_type": "display"
        },
        "provenance": {
          "source_file_hash": "9f8345c8d080da5175b47706f12c084052e642f63554015f809323132f67d335",
          "page_number": 1,
          "extractor_name": "PyMuPDF_pdfplumber",
          "extractor_version": "fitz:1.28.2_pdfplumber:0.11.10",
          "config_id": "O3-v1.0.0",
          "timestamp": "2026-10-29T10:15:00.000000+00:00",
          "parent_element_id": null
        },
        "is_degraded": false,
        "degraded_reasons": []
      }
    ],
    "timestamp": "2026-10-29T10:20:06.000000+00:00"
  }
  ```

---

## 4. Multi-Modal Retrieval Endpoint

### 4.1 Execute Search
- **`POST /api/v1/search`**
- **Description**: Performs dense semantic vector search over structured document chunks using the FAISS index with optional content type filtering and Platt confidence re-weighting.
- **Request Body**:
  ```json
  {
    "query": "What is the relative spatial attention bias formula?",
    "content_type": "Formula",
    "min_score": 0.50,
    "top_k": 5,
    "document_id": null
  }
  ```
  - `content_type`: Optional filter (`"All"`, `"Heading"`, `"Text"`, `"Table"`, `"Formula"`, `"Figure"`).
  - `min_score`: Minimum threshold between $0.0$ and $1.0$.
  - `top_k`: Maximum number of results to return (default 5, max 50).
- **Example Response (200 OK)**:
  ```json
  {
    "config_version": "1.0.0",
    "status": "success",
    "message": "Retrieved 1 results",
    "data": [
      {
        "chunk_id": "chunk_doc-004_p1_0003",
        "document_id": "doc-004",
        "page_number": 1,
        "text": "$$\\text{Bias}(i, j) = \\mathbf{b}_{x}(x_i - x_j) + \\mathbf{b}_{y}(y_i - y_j)$$",
        "content_type": "Formula",
        "score": 0.8942,
        "rank": 1,
        "reading_order": 3,
        "bbox": {
          "x": 50.0,
          "y": 330.0,
          "width": 460.0,
          "height": 65.0
        },
        "formula_latex": "\\text{Bias}(i, j) = \\mathbf{b}_{x}(x_i - x_j) + \\mathbf{b}_{y}(y_i - y_j)",
        "source_file_hash": "9f8345c8d080da5175b47706f12c084052e642f63554015f809323132f67d335",
        "calibrated_confidence": 0.962,
        "is_degraded": false,
        "degraded_reasons": [],
        "fallback_strategy": "STANDARD_PASS"
      }
    ],
    "timestamp": "2026-10-29T10:20:07.000000+00:00"
  }
  ```

---

## 5. Evaluation & Benchmark Telemetry

### 5.1 Latest Evaluation Report
- **`GET /api/v1/evaluation/latest`**
- **Description**: Serves the live empirical evaluation results from the frozen acceptance partition, including the complete KPI matrix with 95% bootstrap confidence intervals.
- **Example Response (200 OK)**:
  ```json
  {
    "config_version": "1.0.0",
    "status": "success",
    "message": "Frozen acceptance partition evaluation report retrieved",
    "data": {
      "timestamp": "acceptance_20261029_095910",
      "overall_decision": "ACCEPT",
      "kpi_table": [
        {
          "kpi_id": "KPI-1",
          "name": "Reading-Order Accuracy (Pairwise Order Accuracy)",
          "description": "Kendall's tau and pairwise layout sequence concordance on multi-column layouts",
          "baseline": "0.720",
          "target": ">= 0.900",
          "achieved": "1.000",
          "ci_95": "[1.000, 1.000]",
          "unit": "Accuracy [0, 1]",
          "status": "PASS"
        },
        {
          "kpi_id": "KPI-6",
          "name": "Query Retrieval Latency (p95)",
          "description": "Warm vector query latency across FAISS dense subword index",
          "baseline": "15.00 ms",
          "target": "< 5.00 ms",
          "achieved": "1.44 ms",
          "ci_95": "[0.87, 0.94] ms",
          "unit": "Milliseconds",
          "status": "PASS"
        }
      ],
      "cohens_kappa_w": 1.0,
      "hit_at_1": 0.667,
      "hit_at_3": 0.889,
      "mrr": 0.800,
      "answer_grounding": 0.556
    },
    "timestamp": "2026-10-29T10:20:08.000000+00:00"
  }
  ```

