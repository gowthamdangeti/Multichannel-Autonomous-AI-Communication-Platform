import pytest
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../backend")))

from app.core.agents.registry import registry
from app.schemas.task import TaskContract

@pytest.mark.asyncio
async def test_agent_registry():
    agents = registry.list_all()
    assert len(agents) == 12

    expected_departments = [
        "Research and Intelligence",
        "Software Engineering",
        "Communication",
        "Business and Sales",
        "Data and Analytics",
        "Document and Knowledge Intelligence",
        "Workflow Automation",
        "Finance and Procurement",
        "IT Operations",
        "Marketing and Content",
        "Security and Governance",
        "Autonomous Evaluation and Optimization"
    ]
    registered_depts = [a.department for a in agents]
    for dept in expected_departments:
        assert dept in registered_depts, f"Missing department: {dept}"

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

@pytest.mark.asyncio
async def test_specialized_agents_execution():
    # Test Software Engineer
    coder = registry.get("lead-software-architect")
    code_contract = TaskContract(
        task_id="task-code-01",
        objective="Implement event queue processor",
        permissions=["read", "write", "execute_tool"]
    )
    code_res = await coder.run(code_contract)
    assert code_res.status == "completed"
    assert len(code_res.artifacts) > 0
    assert code_res.artifacts[0]["type"] == "code"

    # Test Finance Auditor
    finance = registry.get("procurement-finance-auditor")
    finance_contract = TaskContract(
        task_id="task-fin-01",
        objective="Audit vendor cloud hosting invoice",
        input_data={"budget": 10000.0, "quoted_price": 8200.0},
        permissions=["read"]
    )
    fin_res = await finance.run(finance_contract)
    assert fin_res.status == "completed"
    assert fin_res.structured_result["savings_percentage"] == 18.0

    # Test Security Governance Officer
    sec = registry.get("security-governance-officer")
    sec_contract = TaskContract(
        task_id="task-sec-01",
        objective="Audit deployment permissions",
        permissions=["read", "deploy_staging"]
    )
    sec_res = await sec.run(sec_contract)
    assert sec_res.status == "completed"
    assert "governance_status" in sec_res.structured_result
