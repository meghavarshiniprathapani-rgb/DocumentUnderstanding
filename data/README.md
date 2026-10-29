# Retrieva AI — Data Repository

This directory contains test datasets, benchmark annotations, and enterprise PDF samples used for evaluating Retrieva AI.

## Directory Structure

```
data/
├── sample_documents/        # Sample enterprise PDFs (annual reports, policies, whitepapers)
│   └── .gitkeep
├── benchmarks/              # Ground truth annotations and evaluation groundings
│   └── .gitkeep
└── README.md                # Directory documentation
```

## Dataset Guidelines

1. **Format Requirements**: All ingested documents must be valid PDF files conforming to standard PDF specifications.
2. **File Size Constraints**: Maximum 50 MB per document (configured in `Settings.max_upload_size_mb`).
3. **Coordinate System**: Bounding box annotations are normalized relative to page dimensions $(800 \times 1100)$ in $[x, y, \text{width}, \text{height}]$ format.
4. **Confidentiality**: Sample documents included in this repository contain mock data and sanitized academic benchmarks.

