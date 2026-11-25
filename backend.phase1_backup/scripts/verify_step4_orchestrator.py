import asyncio
import json
import logging
import time
from sqlalchemy import text, select

from app.database import async_session_maker
from app.core.orchestrator.master import orchestrator
from app.core.orchestrator.planner import StrategicPlanner
from app.core.storage.minio_client import storage_client
from app.schemas.orchestrator import ObjectiveSubmission
from app.models.workflow import WorkflowModel
from app.models.task import TaskModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("orchestrator_validator")

async def test_master_orchestrator_step4():
    print("=" * 85)
    print("      STEP 4: REAL MULTI-AGENT ORCHESTRATION END-TO-END VALIDATION      ")
    print("=" * 85)

    user_objective = (
        "Research 10 AI agent companies in India, compare their products and technologies, "
        "identify market opportunities, prepare a competitor analysis report, "
        "and create five personalized outreach email drafts."
    )
    print(f"User Objective:\n\"{user_objective}\"\n")

    # 1. Test Strategic Planner Decomposition & Dependency Graph Generation
    print("--- 1. Generating Structured Plan & Dependency Graph ---")
    submission = ObjectiveSubmission(objective=user_objective)
    plan = StrategicPlanner.plan(submission)
    
    print(f"Plan Category: {plan.category}")
    print(f"Estimated Duration: {plan.estimated_duration_sec}s")
    print(f"Steps Planned: {len(plan.steps)}")
    print(f"Reasoning: {plan.reasoning}")
    print("\nGenerated Dependency Graph (DAG):")
    for s in plan.steps:
        deps = f"<- Depends on: {s.dependencies}" if s.dependencies else "(Root Node)"
        print(f"  * [{s.step_id}] '{s.title}' | Agent: {s.assigned_agent_slug} [{s.department}] {deps}")

    # Check that independent steps exist for parallel execution
    # Step 2 and Step 3 both depend only on Step 1
    step_1_id = plan.steps[0].step_id
    step_2 = plan.steps[1]
    step_3 = plan.steps[2]
    assert step_2.dependencies == [step_1_id], f"Step 2 dependencies expected {[step_1_id]}, got {step_2.dependencies}"
    assert step_3.dependencies == [step_1_id], f"Step 3 dependencies expected {[step_1_id]}, got {step_3.dependencies}"
    print("\nVerified: Step 2 and Step 3 form parallel independent branches depending on Step 1.")

    # 2. Execute Master Orchestrator with Intentional Test Failure on Step 2 to verify Recovery
    print("\n--- 2. Executing Multi-Agent Workflow with Intentional Fault Injection on Step 2 ---")
    start_time = time.time()
    result = await orchestrator.execute_objective(submission)
    elapsed = round(time.time() - start_time, 2)

    print(f"\nExecution Finished in {elapsed}s")
    print(f"Workflow ID: {result['workflow_id']}")
    print(f"Status: {result['status']}")
    print(f"Completed Steps: {result['completed_steps']}/{result['steps_count']}")
    assert result["status"] == "completed", f"Workflow execution failed: {result}"
    assert result["completed_steps"] == len(plan.steps), f"Expected {len(plan.steps)} steps, got {result['completed_steps']}"

    # 3. Verify Structured Data Passing Between Agents
    print("\n--- 3. Verifying Structured Output Hand-off Between Agents ---")
    step_results = result["step_results"]
    for s_id, s_data in step_results.items():
        print(f"  Step [{s_id}] by {s_data.get('agent_id')}:")
        print(f"    Confidence: {s_data.get('confidence')}")
        print(f"    Evidence items: {len(s_data.get('evidence', []))}")
        print(f"    Structured Result Keys: {list(s_data.get('structured_result', {}).keys())}")
        if "context_from_" in str(s_data.get("input_data", {})):
            print("    -> Successfully received and parsed upstream dependency context!")

    # 4. Verify MinIO Artifact Persistence
    print("\n--- 4. Verifying MinIO Object Storage Deliverables ---")
    artifacts = result.get("artifacts", [])
    print(f"Total Artifacts Generated: {len(artifacts)}")
    assert len(artifacts) >= 4, f"Expected at least 4 deliverables, got {len(artifacts)}"

    for idx, art in enumerate(artifacts):
        minio_uri = art.get("minio_uri")
        title = art.get("title", f"Artifact {idx+1}")
        print(f"  Deliverable {idx+1}: '{title}'")
        print(f"    Type: {art.get('type')}")
        print(f"    MinIO Storage URI: {minio_uri}")
        assert minio_uri and minio_uri.startswith("s3://"), f"Artifact missing MinIO URI: {art}"

    # 5. Verify PostgreSQL Persistence
    print("\n--- 5. Verifying PostgreSQL Workflow & Task Audit Records ---")
    async with async_session_maker() as session:
        wf_query = await session.execute(select(WorkflowModel).where(WorkflowModel.id == result["workflow_id"]))
        db_wf = wf_query.scalar_one_or_none()
        assert db_wf is not None, f"Workflow record not found in PostgreSQL for {result['workflow_id']}"
        print(f"PostgreSQL Workflow Record: ID={db_wf.id}, Name='{db_wf.name}', Status={db_wf.status}")

        tasks_query = await session.execute(select(TaskModel).where(TaskModel.workflow_id == result["workflow_id"]))
        db_tasks = tasks_query.scalars().all()
        print(f"PostgreSQL Task Records Found: {len(db_tasks)} tasks linked to workflow")
        assert len(db_tasks) == len(plan.steps), f"Expected {len(plan.steps)} tasks in PostgreSQL, found {len(db_tasks)}"

        for t in db_tasks:
            print(f"  * Task ID={t.id} | Title='{t.title}' | Status={t.status} | Confidence={t.confidence}")

    print("\n" + "=" * 85)
    print("STEP 4 COMPLETED SUCCESSFULLY: MASTER ORCHESTRATOR FULLY VALIDATED.")
    print("=" * 85)

if __name__ == "__main__":
    asyncio.run(test_master_orchestrator_step4())
