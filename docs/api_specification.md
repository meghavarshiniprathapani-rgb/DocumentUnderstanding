# Retrieva AI — REST API Specification

All endpoints are served under base prefix `/api/v1` and wrapped in `BaseResponse[T]`.

## Endpoints Summary

### 1. Health Discovery
- **`GET /api/v1/health`**
- **Response**:
  ```json
  {
    "config_version": "1.0.0",
    "status": "success",
    "message": "Retrieva AI engine is fully operational",
    "data": {
      "service": "Retrieva AI Engine",
      "status": "healthy",
      "environment": "development",
      "ocr_engine": "layoutlmv3",
      "vector_db": "faiss",
      "confidence_threshold": 0.85,
      "max_upload_size_mb": 50
    },
    "timestamp": "2026-10-28T17:30:00Z"
  }
  ```

### 2. Document Repository
- **`GET /api/v1/documents`**: List all repository documents.
- **`GET /api/v1/documents/{id}`**: Fetch metadata for a specific document.
- **`POST /api/v1/documents/upload`**: Validates PDF stream and registers document.
- **`GET /api/v1/documents/{id}/pages/{page}`**: Retrieves 2D bounding boxes and extracted text segments for canvas rendering.

### 3. Multi-Modal Spatial Search
- **`POST /api/v1/search`**:
  - Request body:
    ```json
    {
      "query": "What was the revenue growth in Q3?",
      "content_type": "Table",
      "min_score": 0.70,
      "top_k": 10
    }
    ```
  - Returns array of matched segments with bounding coordinates and table data.

