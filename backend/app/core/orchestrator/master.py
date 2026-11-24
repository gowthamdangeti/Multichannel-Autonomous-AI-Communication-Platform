import asyncio
import uuid
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone

from app.schemas.orchestrator import ObjectiveSubmission, ExecutionPlan, PlanStep
from app.schemas.agent import AgentExecutionResult
from app.schemas.task import TaskContract
from app.core.orchestrator.planner import StrategicPlanner
from app.core.agents.registry import registry
from app.core.recovery.error_handler import ErrorRecoveryManager

logger = logging.getLogger(__name__)

class MasterOrchestrator:
    """
    Central Autonomous AI OS Orchestrator.
    Understands objectives -> Creates execution plans -> Selects agents ->
    Executes tasks -> Recovers from errors -> Verifies criteria -> Delivers outputs.
    """

    def __init__(self):
        self.recovery_manager = ErrorRecoveryManager()

    async def execute_objective(self, submission: ObjectiveSubmission) -> Dict[str, Any]:
        workflow_id = f"wf-{uuid.uuid4().hex[:8]}"
        start_time = datetime.now(timezone.utc)
        logger.info(f"Initiating autonomous workflow [{workflow_id}] for objective: '{submission.objective}'")

        # 1. Strategic Planning
        plan: ExecutionPlan = StrategicPlanner.plan(submission)
        logger.info(f"Generated plan with {len(plan.steps)} steps across departments.")

        step_results: Dict[str, AgentExecutionResult] = {}
        all_artifacts: List[Dict[str, Any]] = []
        workflow_status = "completed"

        # 2. Stateful Execution Loop (Dependency Resolution)
        for step in plan.steps:
            logger.info(f"Executing step [{step.step_id}]: {step.title} -> {step.assigned_agent_slug}")
            
            # Resolve inputs from previous dependent steps
            resolved_input = dict(step.input_payload)
            if step.dependencies:
                dep_artifacts = []
                for dep_id in step.dependencies:
                    if dep_id in step_results:
                        dep_res = step_results[dep_id]
                        resolved_input[f"context_from_{dep_id}"] = dep_res.structured_result
                        dep_artifacts.extend(dep_res.artifacts)
                resolved_input["prior_artifacts"] = dep_artifacts

            # Construct strict task contract
            task_contract = TaskContract(
                task_id=f"task-{uuid.uuid4().hex[:8]}",
                parent_task_id=step.dependencies[0] if step.dependencies else None,
                workflow_id=workflow_id,
                assigned_agent=step.assigned_agent_slug,
                objective=step.description,
                input_data=resolved_input,
                constraints=submission.constraints,
                permissions=["read", "write", "execute_tool"],
                success_criteria=["Complete structured output", "Pass verification"]
            )

            # Discover agent
            agent = registry.get(step.assigned_agent_slug)
            if not agent:
                # Dynamic capability fallback
                agent = registry.find_best_match([step.department.lower()])
                if not agent:
                    logger.error(f"No agent found for step {step.step_id}")
                    workflow_status = "failed"
                    break

            # Execute with error recovery & retry wrapper
            result = await self.recovery_manager.execute_with_recovery(agent, task_contract)
            step_results[step.step_id] = result
            all_artifacts.extend(result.artifacts)

            if result.status == "failed":
                workflow_status = "failed"
                logger.error(f"Workflow {workflow_id} halted on step {step.step_id}")
                break

        duration_sec = (datetime.now(timezone.utc) - start_time).total_seconds()

        return {
            "workflow_id": workflow_id,
            "status": workflow_status,
            "objective": submission.objective,
            "category": plan.category,
            "confidence": plan.confidence,
            "steps_count": len(plan.steps),
            "completed_steps": len(step_results),
            "duration_sec": round(duration_sec, 2),
            "step_results": {k: v.dict() for k, v in step_results.items()},
            "artifacts": all_artifacts,
            "summary": f"Autonomous execution completed with {len(all_artifacts)} verified artifacts generated."
        }

orchestrator = MasterOrchestrator()
