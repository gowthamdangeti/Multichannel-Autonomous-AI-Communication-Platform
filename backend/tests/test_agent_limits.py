from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from api.services.billing import agent_limits as al


@pytest.mark.asyncio
async def test_free_org_blocks_second_agent(monkeypatch):
    guard = al.AgentLimitGuard()
    monkeypatch.setattr(guard, "get_usage", __import__("unittest.mock", fromlist=["AsyncMock"]).AsyncMock(
        return_value={"voice": 1, "chat": 0, "whatsapp": 0, "total": 1}
    ))
    monkeypatch.setattr(guard, "is_paid", __import__("unittest.mock", fromlist=["AsyncMock"]).AsyncMock(return_value=False))
    with pytest.raises(HTTPException) as e:
        await guard.assert_can_create_agent(1, kind="voice", user=SimpleNamespace(is_superuser=False))
    assert e.value.status_code == 402
    assert e.value.detail["code"] == "agent_limit_reached"


@pytest.mark.asyncio
async def test_free_org_allows_first_agent(monkeypatch):
    from unittest.mock import AsyncMock

    guard = al.AgentLimitGuard()
    monkeypatch.setattr(guard, "get_usage", AsyncMock(
        return_value={"voice": 0, "chat": 0, "whatsapp": 0, "total": 0}
    ))
    monkeypatch.setattr(guard, "is_paid", AsyncMock(return_value=False))
    usage = await guard.assert_can_create_agent(1, kind="chat", user=SimpleNamespace(is_superuser=False))
    assert usage["total"] == 0


@pytest.mark.asyncio
async def test_paid_org_unlimited(monkeypatch):
    from unittest.mock import AsyncMock

    guard = al.AgentLimitGuard()
    monkeypatch.setattr(guard, "get_usage", AsyncMock(
        return_value={"voice": 5, "chat": 5, "whatsapp": 5, "total": 15}
    ))
    monkeypatch.setattr(guard, "is_paid", AsyncMock(return_value=True))
    usage = await guard.assert_can_create_agent(1, kind="voice", user=SimpleNamespace(is_superuser=False))
    assert usage["total"] == 15


@pytest.mark.asyncio
async def test_superuser_bypass(monkeypatch):
    from unittest.mock import AsyncMock

    guard = al.AgentLimitGuard()
    monkeypatch.setattr(guard, "get_usage", AsyncMock(
        return_value={"voice": 9, "chat": 0, "whatsapp": 0, "total": 9}
    ))
    # is_paid not even consulted for superuser
    usage = await guard.assert_can_create_agent(1, kind="voice", user=SimpleNamespace(is_superuser=True))
    assert usage["total"] == 9
