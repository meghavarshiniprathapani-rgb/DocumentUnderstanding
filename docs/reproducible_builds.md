# Reproducible Builds & Development Environments

Retrieva AI enforces reproducible builds across local machines, Docker containers, and CI pipelines.

## Principles

1. **Pinned Dependency Versions**: All dependencies in `requirements.txt` and `package.json` are strictly pinned with exact version numbers.
2. **Deterministic Configuration**: `Settings.config_version` records the active system parameters in all serialized outputs.
3. **One-Command Orchestration**: The `Makefile` and helper scripts (`make.cmd`, `make.ps1`) provide uniform commands across platforms:
   - `make setup`
   - `make test`
   - `make run-backend`
   - `make run-frontend`
   - `make run-eval`
4. **Hermetic Containers**: `Dockerfile` builds from clean `python:3.11-slim` and executes the full test suite during verification.

