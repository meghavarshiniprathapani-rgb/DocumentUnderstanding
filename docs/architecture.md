# Retrieva AI — Architecture Documentation

## 1. System Architecture Overview

Retrieva AI implements a multi-tier, decoupled architecture combining a modern React 19 frontend, an Express-based API orchestrator and persistence layer, and a Python 3.11 FastAPI service dedicated to document understanding, spatial intelligence, and vector retrieval.

```
┌─────────────────────────────────────────────────────────────┐
│                       CLIENT TIER                           │
│  React 19 + Vite 8 + Tailwind CSS v4 (Port: 5173)           │
│  • Interactive 2D Bounding Box Canvas (70% - 150% Zoom)     │
│  • Multi-Modal Search Console with Rich Result Cards        │
│  • Omni-Search (Cmd/Ctrl + K) & Global Navigation           │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP / JSON (CORS)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                EXPRESS API ORCHESTRATOR TIER                │
│  Node.js (v20+) Express 5 Engine (Port: 3001)               │
│  • Request routing, tracing (X-Request-Id), and CORS        │
│  • Request timing (X-Process-Time-Ms) & config enforcement  │
│  • Centralized MySQL 8.4 connection pool & repositories     │
│  • Job queueing, status tracking, and worker dispatching    │
│  • Structured JSON request logging & credential scrubbing   │
│  • Health (liveness) & Readiness (dependency probe) APIs    │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP Internal (REST)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│               PYTHON INTELLIGENCE SERVICE TIER              │
│  FastAPI (Python 3.11) + Uvicorn (Port: 8000)               │
│  • Document layout analysis (LayoutLMv3, PaddleOCR, Docling)│
│  • Reading-order recovery & spatial topological sorting     │
│  • O3 multi-signal confidence fusion & Platt calibration    │
│  • FAISS in-memory approximate nearest neighbor search      │
│  • Cryptographic SHA-256 audit lineage & provenance         │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                      PERSISTENCE TIER                       │
│  • MySQL 8.4.9 InnoDB (Port: 3306) — Owned by Express       │
│    - Documents, elements, extraction jobs, eval runs        │
│    - Atomic connection pool (max 5 conns, 20 queue limit)   │
│    - Transactional row locks with SKIP LOCKED concurrency   │
│  • FAISS Vector Store — In-Memory owned by Python           │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Service Separation & Responsibilities

| Responsibility | Express Orchestrator (Port 3001) | Python Intelligence Service (Port 8000) |
| :--- | :---: | :---: |
| **HTTP Routing & Ingestion** | Primary Gateway (`/api/v1`) | Specialized Intelligence Subsystem |
| **Request Tracing & ID** | Originates `X-Request-Id` | Inherits trace context |
| **CORS Negotiation** | Enforces allowed origins & credentials | Internal / Secondary Gateway |
| **Payload Size Enforcement** | Enforces 50MB upload limit | Ingestion processing |
| **Database Persistence** | **Exclusive Owner** (`documents`, `elements`, `jobs`, `eval_runs`) | Read-only / Stateless consumer |
| **Database Pool Management** | Managed MySQL pool (`mysql2/promise`) | None (no direct MySQL connection) |
| **Job Queue & Scheduling** | Row-locked dispatch (`SKIP LOCKED`) | Task worker |
| **Document OCR & Layout** | Delegated | **Exclusive Owner** (Docling, LayoutLMv3) |
| **Reading-Order Recovery** | Delegated | **Exclusive Owner** (Spatial graph) |
| **Confidence Calibration** | Delegated | **Exclusive Owner** (Platt scaling, ECE) |
| **FAISS Vector Indexing** | Delegated | **Exclusive Owner** (In-memory ANN) |

---

## 3. Storage & State Ownership

1. **MySQL 8.4 Database Ownership**:
   - Owned exclusively by the Express backend (`backend/src/db/`).
   - Managed via the centralized `pool.js` connection pool:
     - `connectionLimit: 5`
     - `waitForConnections: true`
     - `queueLimit: 20`
     - `connectTimeout: 10000ms`
     - `acquireTimeout: 10000ms`
     - Keep-alive enabled with zero initial delay.
   - Migration execution and DDL advisory locks strictly run on dedicated single connections isolated from pooled worker connections.
   - Repository layer (`backend/src/db/repositories/`) encapsulates entity persistence for `documents`, `elements`, `jobs`, and `eval_runs`.

2. **FAISS Vector Index Ownership**:
   - Owned and managed in-memory by the Python FastAPI service.
   - Vectors are held in RAM for fast sub-millisecond approximate nearest neighbor searches.

---

## 4. Networking, Ports & Environment Configuration

| Service | Environment Variable | Default Host | Default Port | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Express Orchestrator** | `PORT` or `EXPRESS_PORT` | `0.0.0.0` | `3001` | Avoids collision with Vite, FastAPI, and MySQL |
| **Python FastAPI** | `PORT` | `0.0.0.0` | `8000` | Intelligence service |
| **React Frontend (Vite)** | `VITE_PORT` | `localhost` | `5173` | Web UI |
| **MySQL Server** | `DB_PORT` | `127.0.0.1` | `3306` | MySQL 8.4.9 database |

### Key Environment Variables (`.env`)
- `APP_NAME`: Service display name (default: `Retrieva AI Orchestrator`).
- `NODE_ENV`: Runtime tier (`development`, `test`, `production`).
- `EXPRESS_PORT`: Express network port (default: `3001`).
- `MAX_UPLOAD_SIZE_MB`: Max file upload limit (default: `50`).
- `CORS_ORIGINS`: Comma-separated allowed origins (e.g., `http://localhost:5173,http://localhost:3000`).
- `PYTHON_SERVICE_URL`: URL to Python intelligence backend (default: `http://127.0.0.1:8000`).
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`: MySQL connection parameters.

---

## 5. Independent Service Startup

Each tier can be started and inspected independently:

```bash
# 1. Start MySQL Server (if not already running as a daemon)
mysqld --defaults-file="D:\mysql_data\my.ini" --console

# 2. Run Database Migrations
cd backend
npm run migrate

# 3. Start Express Orchestrator (Port 3001)
cd backend
npm start
# or: node src/server.js

# 4. Start Python FastAPI Intelligence Service (Port 8000)
cd backend
python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000

# 5. Start React Frontend (Port 5173)
npm run dev
```

---

## 6. Universal Response Envelope & Traceability Headers

Every response emitted by the Express Orchestrator strictly adheres to the established Retrieva AI envelope contract:

```json
{
  "config_version": "1.0.0",
  "status": "success",
  "data": { ... },
  "message": "Human-readable informational status",
  "timestamp": "2026-11-26T09:00:00.000Z"
}
```

### Invariant HTTP Response Headers:
- `X-Config-Version`: Immutable configuration version identifier (`1.0.0`).
- `X-Process-Time-Ms`: High-precision duration of request processing in milliseconds.
- `X-Request-Id`: Unique request identifier (propagated from client or generated as UUID v4).

---

## 7. Health and Readiness Endpoints

### 7.1 Liveness Probe (`GET /api/v1/health`)
Verifies process execution and process uptime. Returns HTTP 200.
```json
{
  "config_version": "1.0.0",
  "status": "success",
  "message": "Service is operational",
  "data": {
    "service": "Retrieva AI Orchestrator",
    "status": "healthy",
    "environment": "development",
    "uptime_seconds": 124.5,
    "timestamp": "2026-11-26T09:00:00.000Z"
  },
  "timestamp": "2026-11-26T09:00:00.000Z"
}
```

### 7.2 Readiness Probe (`GET /api/v1/ready`)
Verifies critical operational dependencies.
- **MySQL Database**: Probes live connection pool via `pool.healthCheck()`.
- **Python Intelligence Service**: Probes `${PYTHON_SERVICE_URL}/api/v1/health` with a 1500ms timeout and records status accurately (`healthy`, `unavailable`, `not_configured`) without false claims.
- **Status Code**: Returns HTTP 200 when ready. Returns HTTP 503 when dependencies are degraded/unready.

```json
{
  "config_version": "1.0.0",
  "status": "success",
  "message": "All dependencies ready",
  "data": {
    "service": "Retrieva AI Orchestrator",
    "status": "ready",
    "checks": {
      "mysql": {
        "status": "healthy",
        "latencyMs": 4,
        "timestamp": "2026-11-26T09:00:00.000Z",
        "details": {
          "database": "docuretrieve",
          "healthy": true
        }
      },
      "python_service": {
        "status": "healthy",
        "details": { ... },
        "timestamp": "2026-11-26T09:00:00.000Z"
      }
    },
    "timestamp": "2026-11-26T09:00:00.000Z"
  },
  "timestamp": "2026-11-26T09:00:00.000Z"
}
```

---

## 8. O3 Provenance, Multi-Signal Confidence & Degraded Routing

The `backend/provenance/` package implements the O3 contribution as an isolated subsystem:
- **Audit Lineage**: Cryptographic SHA-256 file hashing, page number, bounding box, extractor identity/version, config ID, and extraction timestamp.
- **Multi-Signal Calibrated Confidence**: Weighted fusion of raw extractor confidence, dual-extractor spatial agreement, table topological consistency, and reading-order concordance, calibrated via Platt scaling (ECE evaluation).
- **Degraded Routing**: Automatic flagging of low-confidence or critical elements below configured thresholds with dispatch to fallback strategies (`RAW_SLICE_FALLBACK`, `BOUNDING_BOX_UNION`, `HUMAN_REVIEW_QUEUE`).

See [provenance_confidence_subsystem.md](file:///c:/Disk%20D/Capstone/docs/provenance_confidence_subsystem.md) for full architectural specifications and empirical ablation study findings.
