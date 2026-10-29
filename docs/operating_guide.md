# Retrieva AI — Production Operations & Reliability Guide

This guide details the operational procedures, observability telemetry, degraded-mode routing, and automated recovery paths for **Retrieva AI** (Project AIML-59, KL University).

---

## 1. Overview & Service Architecture

Retrieva AI runs as a split-stack service:
- **Backend**: FastAPI REST service running on `http://localhost:8000` (`backend.app.main:app`).
- **Frontend**: Vite + React 19 application running on `http://localhost:5173`.
- **Extraction & Inference Engine**: Pinned Python modules for PDF layout analysis (`backend.extractors`), reading-order recovery (`backend.layout`), cryptographic provenance & Platt confidence calibration (`backend.provenance`), and dense FAISS vector indexing (`backend.retrieval`).

---

## 2. Structured JSON Logging

### 2.1 Logging Design & Format
All HTTP requests, startup lifecycle events, background tasks, and error traces emit machine-readable, single-line JSON logs to `stdout`.

Log entries conform to the following schema:
```json
{
  "timestamp": "2026-10-29T10:15:30.124851+00:00",
  "level": "INFO",
  "method": "POST",
  "path": "/api/v1/search",
  "status_code": 200,
  "duration_ms": 1.44,
  "config_version": "1.0.0"
}
```

### 2.2 Response Headers
Every HTTP response is stamped with observability headers by middleware:
- `X-Config-Version`: The immutable bundle configuration version (e.g. `1.0.0`).
- `X-Process-Time-Ms`: End-to-end request execution duration in milliseconds.

### 2.3 Error Logging & Tracking
When an unhandled exception or pipeline fault occurs:
1. The exception details and stack trace are logged with `"level": "ERROR"`.
2. The error is recorded into the in-memory health metrics buffer (`DocumentService.last_error`).
3. An HTTP 500 JSON payload is returned with the error message and active configuration ID, avoiding opaque failures.

---

## 3. Operational Health Monitoring (`/api/v1/health`)

### 3.1 Endpoint Specification
- **Method**: `GET`
- **Path**: `/api/v1/health`
- **Authentication**: None (open health check)

### 3.2 Metrics Payload
Returns real-time telemetry describing active model components, index dimensions, memory footprint, and degraded state:

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
    "uptime_seconds": 342.18,
    "memory_usage_mb": 0.04,
    "ocr_engine": "pymupdf_pdfplumber",
    "vector_db": "faiss",
    "confidence_threshold": 0.75,
    "max_upload_size_mb": 50,
    "max_pages_per_document": 100
  },
  "timestamp": "2026-10-29T10:15:35.000000+00:00"
}
```

### 3.3 Key Health Indicators
| Field | Normal Threshold | Alert Condition | Diagnostic Action |
| :--- | :--- | :--- | :--- |
| `status` | `"healthy"` | `"degraded"` | Inspect `last_error` and call recovery endpoint |
| `memory_usage_mb` | $< 50.0\text{ MB}$ | $> 100.0\text{ MB}$ | Potential memory leak in uncollected index buffers |
| `degraded_mode_active` | `false` | `true` | Low confidence elements or scrambled order detected |
| `index_size` | $\ge 1$ | `0` | Vector index empty; reload corpus |

---

## 4. Degraded Mode & Anomaly Handling

To guarantee that corrupt, scrambled, or uncertain extractions are **never returned silently**, Retrieva AI routes failing inputs to an audited **Degraded Mode**.

### 4.1 Trigger Conditions
The system enters degraded mode under any of five controlled failure conditions:
1. **Low Confidence**: Platt-calibrated multi-signal confidence score falls below $0.75$ (`low_confidence_threshold`).
2. **Critical Scene Failure**: A critical document element (legal mandate, financial table, primary theorem) scores below $0.85$ (`critical_scene_strict_threshold`).
3. **Scrambled Reading Order**: Topological gutter analysis detects horizontal cross-column zigzag jumps ($\ge 2$ cross-jumps or vertical inversions).
4. **Flattened Tables**: Table element contains $\le 1$ cell or topological cell adjacency consistency $< 0.60$.
5. **Resource Exhaustion**: Document size exceeds $50\text{ MB}$ or page count exceeds $100$ pages.

### 4.2 System Behavior in Degraded Mode
- **Transparent Labelling**: Every affected chunk or search result is marked with `is_degraded: true`.
- **Diagnostic Reasons**: The exact rationale is attached to the output:
  ```json
  {
    "is_degraded": true,
    "degraded_reasons": [
      "Platt calibrated confidence (0.642) < threshold 0.750",
      "Page 1: Scrambled multi-column reading order detected (3 horizontal cross-column jumps)"
    ],
    "fallback_strategy": "DEGRADED_FLAGGED_RETRIEVAL"
  }
  ```
- **UI Warning Banner**: The frontend Document Inspector renders an amber warning alert with full diagnostic provenance, warning the user against automated downstream ingestion.
- **Zero Silent Failures**: The system never promotes a degraded or corrupted result to an unflagged standard result.

---

## 5. Automated Recovery Paths

When degraded mode is active or an invalid configuration bundle is loaded, administrators can restore the system to a clean, verified state using one of two methods:

### 5.1 API Recovery Path (`POST /api/v1/health/reload`)
Calling the reload endpoint triggers a live hot-reload without restarting the FastAPI process:
```bash
curl -X POST http://localhost:8000/api/v1/health/reload
```

**Actions Executed:**
1. Resets `degraded_mode_active = false`.
2. Clears the `last_error` diagnostic register.
3. Reloads the accepted configuration bundle (`O3-v1.0.0`).
4. Flushes transient vector buffers and rebuilds the FAISS index from the verified baseline corpus.
5. Returns confirmation JSON:
   ```json
   {
     "status": "success",
     "message": "Accepted model/config bundle reloaded. Degraded mode reset.",
     "data": {
       "status": "success",
       "config_id": "O3-v1.0.0",
       "reindexed_chunks": 13,
       "degraded_mode_active": false
     }
   }
   ```

### 5.2 CLI Recovery Tool (`eval/recovery.py`)
For headless CI/CD environments or pre-flight integrity restoration:
```bash
# Verify lock and restore accepted configuration for all components
python -m eval.recovery --case all

# Re-run specific affected negative test class after recovery
python -m eval.recovery --case NT1
```

**Actions Executed:**
1. Cryptographically verifies [`data/acceptance.lock`](file:///c:/Disk%20D/Capstone/data/acceptance.lock) against [`data/manifest.yaml`](file:///c:/Disk%20D/Capstone/data/manifest.yaml).
2. Resets `LayoutConfig` and `ProvenanceConfig` to default production values.
3. Reruns the negative anomaly test suite to ensure the system passes all assertions.

---

## 6. Daily Operations Checklist

```
[ ] 1. Run acceptance benchmark:        make accept
[ ] 2. Check health endpoint:            curl http://localhost:8000/api/v1/health
[ ] 3. Verify zero document leakage:     python -m eval.leakage
[ ] 4. Run automated test suite:         pytest tests -v
[ ] 5. Verify frontend production build: npm run build
```

