import pytest
import sys
import os

# Add backend to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../backend")))

from app.main import app
from app.config import settings

def test_config_loads():
    assert settings.PROJECT_NAME == "Autonomous AI OS"
    assert settings.API_V1_STR == "/api/v1"
    assert "senior-researcher" is not None

def test_root_structure():
    assert app.title == "Autonomous AI OS"
