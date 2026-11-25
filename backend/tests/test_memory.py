import pytest
from app.database import async_session_maker
from app.core.memory.manager import memory_manager

@pytest.mark.asyncio
async def test_semantic_and_procedural_memory():
    async with async_session_maker() as session:
        # 1. Semantic memory
        item = await memory_manager.store_semantic(
            db=session,
            org_id="org-default",
            key="enterprise_architecture_principles",
            content="Autonomous agents must obey least privilege, idempotency, and audit logging.",
            metadata={"domain": "architecture", "classification": "internal"}
        )
        assert item.id is not None

        results = await memory_manager.search_semantic(session, org_id="org-default", query="architecture", limit=5)
        assert len(results) > 0
        assert any(r["key"] == "enterprise_architecture_principles" for r in results)

        # 2. Procedural memory
        playbook = await memory_manager.store_procedural(
            db=session,
            org_id="org-default",
            workflow_name="security_incident_triage",
            procedure_steps=[
                {"step": 1, "action": "isolate_container"},
                {"step": 2, "action": "dump_memory_audit"},
                {"step": 3, "action": "notify_secops"}
            ]
        )
        assert playbook.id is not None

        retrieved = await memory_manager.get_procedural(session, org_id="org-default", workflow_name="security_incident_triage")
        assert retrieved is not None
        assert len(retrieved["steps"]) == 3
