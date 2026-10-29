# ==============================================================================
# Retrieva AI — Reproducible Container Build
# Base: Python 3.11-slim with Node.js 20 LTS for unified backend & frontend verification
# ==============================================================================

FROM python:3.11-slim AS base

# Prevent Python from writing .pyc files and enable unbuffered logging
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive

WORKDIR /app

# Install system dependencies, curl, and Node.js 20 LTS
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    build-essential \
    make \
    ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install pinned Python dependencies
COPY requirements.txt pyproject.toml ./
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Install pinned Node.js dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy application source code
COPY backend/ ./backend/
COPY eval/ ./eval/
COPY data/ ./data/
COPY docs/ ./docs/
COPY tests/ ./tests/
COPY public/ ./public/
COPY src/ ./src/
COPY index.html vite.config.js .oxlintrc.json Makefile README.md ./

# Run full test suite & frontend compilation in clean build environment
RUN pytest tests -v && npm run build

# Expose ports for FastAPI (8000) and Vite (5173)
EXPOSE 8000 5173

# Default startup command launches FastAPI server
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]

