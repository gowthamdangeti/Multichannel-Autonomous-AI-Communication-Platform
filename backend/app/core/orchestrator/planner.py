import uuid
from typing import List, Dict, Any
from app.schemas.orchestrator import ObjectiveSubmission, ExecutionPlan, PlanStep
from app.core.agents.registry import registry

class StrategicPlanner:
    """
    Decomposes natural language user objectives into structured multi-step execution plans
    with explicit dependency graphs and capability-matched agent allocations.
    """
    
    @staticmethod
    def plan(submission: ObjectiveSubmission) -> ExecutionPlan:
        objective = submission.objective.strip()
        lower_obj = objective.lower()

        # Capability detection
        is_software = any(kw in lower_obj for kw in ["code", "software", "api", "backend", "frontend", "bug", "architecture"])
        is_data = any(kw in lower_obj for kw in ["data", "metrics", "analytics", "kpi", "performance", "throughput"])
        is_comms = any(kw in lower_obj for kw in ["email", "memo", "report", "brief", "message", "announcement"])

        category = "Strategic Intelligence & Execution"
        if is_software:
            category = "Software Engineering & Architecture"
        elif is_data:
            category = "Data & Analytics Operations"

        steps: List[PlanStep] = []

        # Step 1: Research & Context Extraction
        step_1_id = f"step-{uuid.uuid4().hex[:6]}"
        steps.append(PlanStep(
            step_id=step_1_id,
            title="Gather Intelligence & Synthesize Requirements",
            description=f"Conduct thorough research and baseline analysis for: '{objective}'",
            department="Research and Intelligence",
            assigned_agent_slug="senior-researcher",
            dependencies=[],
            action_type="agent",
            input_payload={"query": objective, "depth": "comprehensive"}
        ))

        # Step 2: Core Domain Action (Code or Data or Advanced Analysis)
        step_2_id = f"step-{uuid.uuid4().hex[:6]}"
        if is_software:
            steps.append(PlanStep(
                step_id=step_2_id,
                title="Design & Implement Architecture Spec",
                description="Produce clean modular code structure and unit tests based on research spec.",
                department="Software Engineering",
                assigned_agent_slug="lead-software-architect",
                dependencies=[step_1_id],
                action_type="agent",
                input_payload={"spec": objective, "tech_stack": ["FastAPI", "Next.js", "PostgreSQL"]}
            ))
        elif is_data:
            steps.append(PlanStep(
                step_id=step_2_id,
                title="Execute Quantitative Modeling & Telemetry Analysis",
                description="Calculate operational KPIs, evaluate baseline performance, and detect anomalies.",
                department="Data and Analytics",
                assigned_agent_slug="principal-data-analyst",
                dependencies=[step_1_id],
                action_type="agent",
                input_payload={"metrics_scope": objective}
            ))
        else:
            steps.append(PlanStep(
                step_id=step_2_id,
                title="Synthesize Strategic Vectors & Metrics",
                description="Analyze qualitative findings, project future states, and formulate metrics.",
                department="Data and Analytics",
                assigned_agent_slug="principal-data-analyst",
                dependencies=[step_1_id],
                action_type="agent",
                input_payload={"metrics_scope": objective}
            ))

        # Step 3: Synthesis & Executive Communication Deliverable
        step_3_id = f"step-{uuid.uuid4().hex[:6]}"
        steps.append(PlanStep(
            step_id=step_3_id,
            title="Format Executive Brief & Actionable Deliverable",
            description="Synthesize technical and operational outcomes into an executive memo.",
            department="Communication",
            assigned_agent_slug="communications-director",
            dependencies=[step_2_id],
            action_type="agent",
            input_payload={"audience": "Executive Leadership", "topic": objective}
        ))

        return ExecutionPlan(
            objective=objective,
            category=category,
            confidence=0.96,
            reasoning="Constructed sequential dependency plan: Intelligence Gathering -> Specialized Domain Action -> Executive Synthesis.",
            steps=steps,
            estimated_duration_sec=len(steps) * 5
        )
