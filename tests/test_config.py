"""
Retrieva AI — Configuration Tests
Validates Pydantic settings parsing, constraints, and config_version integrity.
"""

import pytest
from pydantic import ValidationError

from backend.app.config import Settings, get_settings


def test_default_settings_validity():
    """Ensures default settings load with expected attributes and valid types."""
    settings = get_settings()
    assert settings.config_version == "1.0.0"
    assert settings.app_name == "Retrieva AI Engine"
    assert settings.environment in ["development", "staging", "production", "test"]
    assert settings.port == 8000
    assert settings.confidence_threshold == 0.85
    assert settings.max_upload_size_mb == 50
    assert len(settings.cors_origins) > 0


def test_config_version_non_empty():
    """Ensures config_version rejects empty strings."""
    with pytest.raises(ValidationError):
        Settings(config_version="")


def test_confidence_threshold_bounds():
    """Ensures confidence_threshold enforces [0.0, 1.0] range."""
    # Valid bounds
    s1 = Settings(confidence_threshold=0.0)
    assert s1.confidence_threshold == 0.0
    s2 = Settings(confidence_threshold=1.0)
    assert s2.confidence_threshold == 1.0

    # Invalid bounds
    with pytest.raises(ValidationError):
        Settings(confidence_threshold=-0.1)

    with pytest.raises(ValidationError):
        Settings(confidence_threshold=1.1)


def test_upload_size_limit_bounds():
    """Ensures max_upload_size_mb enforces positive non-zero limits."""
    with pytest.raises(ValidationError):
        Settings(max_upload_size_mb=0)

    with pytest.raises(ValidationError):
        Settings(max_upload_size_mb=-5)
