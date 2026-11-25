import pytest
from app.database import async_session_maker
from app.core.governance.hitl import hitl_manager
from app.core.evaluation.evaluator import evaluator

@pytest.mark.asyncio
async def test_hitl_approval_lifecycle():
    async with async_session_maker() as session:
        # Create approval request
        req = await hitl_manager.create_request(
            db=session,
            agent_slug="lead-software-architect",
            action="Deploy container to Kubernetes namespace",
            risk_level="critical",
            summary="Requesting human sign-off for production deployment"
        )
        assert req["status"] == "pending"
        req_id = req["id"]

        # List pending
        pending = await hitl_manager.list_pending(session)
        assert any(p["id"] == req_id for p in pending)

        # Approve request
        decision = await hitl_manager.decide(
            db=session,
            request_id=req_id,
            decision="approved",
            decided_by="admin-auditor",
            comment="Verified container image signature"
        )
        assert decision["status"] == "approved"

@pytest.mark.asyncio
async def test_autonomous_evaluation_pipeline():
    report = await evaluator.evaluate_execution(
        target_id="wf-test-eval-01",
        target_type="workflow",
        metrics={"duration_ms": 420.0, "tool_success": True, "confidence": 0.98}
    )
    assert report.composite_score >= 90.0
    assert report.sandbox_verification == "passed"
    assert len(report.proposed_optimizations) > 0
