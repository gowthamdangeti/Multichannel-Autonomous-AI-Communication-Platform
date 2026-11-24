import pytest
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../backend")))

from app.core.agents.registry import registry
from app.schemas.task import TaskContract

@pytest.mark.asyncio
async def test_agent_registry():
    agents = registry.list_all()
    assert len(agents) >= 4
    slugs = [a.slug for a in agents]
    assert "senior-researcher" in slugs
    assert "communications-director" in slugs
    assert "lead-software-architect" in slugs
    assert "principal-data-analyst" in slugs

@pytest.mark.asyncio
async def test_agent_execution_contract():
    agent = registry.get("senior-researcher")
    assert agent is not None

    contract = TaskContract(
        task_id="test-task-001",
        objective="Analyze AI Operating Systems architecture",
        input_data={"query": "AI OS architecture", "depth": "rapid"}
    )

    result = await agent.run(contract)
    assert result.status == "completed"
    assert result.confidence >= 0.9
    assert len(result.evidence) > 0
    assert len(result.artifacts) > 0
    assert result.artifacts[0]["type"] == "markdown"
