# Retrieva AI — Architecture Documentation

## 1. System Architecture Overview

Retrieva AI combines a modern React 19 frontend and a Python 3.11 FastAPI backend designed for reproducible, multi-modal spatial document retrieval.

```
┌─────────────────────────────────────────────────────────────┐
│                       CLIENT TIER                           │
│  React 19 + Vite 8 + Tailwind CSS v4                        │
│  • Interactive 2D Bounding Box Canvas (70% - 150% Zoom)     │
│  • Multi-Modal Search Console with Rich Result Cards        │
│  • Omni-Search (Cmd/Ctrl + K) & Global Navigation           │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP / JSON (CORS)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                       BACKEND TIER                          │
│  FastAPI (Python 3.11) + Pydantic v2 Settings               │
│  • Validated config_version recorded in every output        │
│  • Endpoints for health, documents, and search              │
│  • Modular pipeline ready for model integration             │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                      EVALUATION TIER                        │
│  Benchmark Runner & Spatial Metrics                         │
│  • IoU (Intersection over Union) computation                │
│  • FUNSD, CORD, and Table extraction benchmark tracking    │
│  • Config version embedded in evaluation reports            │
└─────────────────────────────────────────────────────────────┘
```

## 2. Configuration Version Invariant

Every response from the backend service or evaluation suite must contain the immutable `config_version` string:

- HTTP Header: `X-Config-Version: 1.0.0`
- Response Envelope: `{"config_version": "1.0.0", "status": "success", ...}`
- Evaluation Report: `{"config_version": "1.0.0", "aggregate_metrics": ...}`

This ensures total traceability across experiments, deployments, and benchmark runs.

## 3. O3 Provenance, Multi-Signal Confidence & Degraded Routing

The `backend/provenance/` package implements the O3 contribution as an isolated subsystem:
- **Audit Lineage**: Cryptographic SHA-256 file hashing, page number, bounding box, extractor identity/version, config ID, and extraction timestamp.
- **Multi-Signal Calibrated Confidence**: Weighted fusion of raw extractor confidence, dual-extractor spatial agreement, table topological consistency, and reading-order concordance, calibrated via Platt scaling (ECE evaluation).
- **Degraded Routing**: Automatic flagging of low-confidence or critical elements below configured thresholds with dispatch to fallback strategies (`RAW_SLICE_FALLBACK`, `BOUNDING_BOX_UNION`, `HUMAN_REVIEW_QUEUE`).

See [provenance_confidence_subsystem.md](file:///c:/Disk%20D/Capstone/docs/provenance_confidence_subsystem.md) for full architectural specifications and empirical ablation study findings.

