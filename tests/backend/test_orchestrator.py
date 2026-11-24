import pytest
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../backend")))

from app.core.orchestrator.planner import StrategicPlanner
from app.core.orchestrator.master import orchestrator
from app.schemas.orchestrator import ObjectiveSubmission

def test_strategic_planner_decomposition():
    submission = ObjectiveSubmission(
        objective="Develop an autonomous data pipeline and report to executive leadership"
    )
    plan = StrategicPlanner.plan(submission)
    assert plan.steps_count if hasattr(plan, "steps_count") else len(plan.steps) == 3
    assert plan.steps[0].assigned_agent_slug == "senior-researcher"
    assert plan.steps[2].assigned_agent_slug == "communications-director"

@pytest.mark.asyncio
async def test_end_to_end_autonomous_execution():
    submission = ObjectiveSubmission(
        objective="Analyze enterprise AI multi-agent orchestration frameworks and produce report"
    )
    execution_result = await orchestrator.execute_objective(submission)
    
    assert execution_result["status"] == "completed"
    assert execution_result["completed_steps"] == 3
    assert len(execution_result["artifacts"]) >= 2
    assert execution_result["workflow_id"].startswith("wf-")
