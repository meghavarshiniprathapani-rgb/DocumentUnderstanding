"""
Retrieva AI — Pytest Configuration & Test Fixtures
Provides reusable TestClient and Settings fixtures.
"""

import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings, get_settings
from backend.app.main import app


@pytest.fixture(scope="session")
def test_settings() -> Settings:
    """Provides validated test settings."""
    return get_settings()


@pytest.fixture(scope="module")
def client() -> TestClient:
    """Provides configured FastAPI HTTP TestClient."""
    with TestClient(app) as test_client:
        yield test_client
