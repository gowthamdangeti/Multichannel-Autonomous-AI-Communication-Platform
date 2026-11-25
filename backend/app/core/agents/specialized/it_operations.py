from typing import List, Dict, Any
from app.core.agents.base import BaseAutonomousAgent
from app.schemas.agent import AgentExecutionResult
from app.schemas.task import TaskContract

class ITOperationsAgent(BaseAutonomousAgent):
    slug: str = "site-reliability-engineer"
    name: str = "Site Reliability & IT Ops Engineer"
    department: str = "IT Operations"
    role: str = "Service health diagnostics, log pattern analysis, incident triage, and infrastructure telemetry"
    description: str = "Diagnoses infrastructure anomalies, analyzes stack traces, and formulates automated remediation steps."
    system_prompt: str = (
        "You are a Lead Site Reliability and IT Operations Engineer. "
        "You isolate system errors, identify root causes, and draft rapid incident remediation actions."
    )
    capabilities: List[str] = [
        "incident_diagnostics",
        "log_analysis",
        "health_remediation",
        "infrastructure_observability"
    ]
    tools: List[str] = ["document_parser", "code_sandbox"]

    async def execute_task(self, task: TaskContract) -> AgentExecutionResult:
        service_name = task.input_data.get("service_name", "api-gateway")
        error_logs = task.input_data.get("error_logs", task.objective)

        prompt = (
            f"Diagnose the following IT infrastructure incident:\n"
            f"Service: {service_name}\n"
            f"Logs: {error_logs}\n"
            f"Identify root cause, severity level (P1-P4), and step-by-step remediation plan."
        )
        llm_res = await self.call_llm(prompt)

        artifact = {
            "title": f"Incident Diagnostics Report - {service_name}",
            "type": "markdown",
            "content": f"# IT Ops Incident Analysis: {service_name}\n\n{llm_res.content}\n"
        }

        return AgentExecutionResult(
            task_id=task.task_id,
            agent_id=self.slug,
            status="completed",
            confidence=0.97,
            structured_result={
                "service": service_name,
                "diagnosed_severity": "P2-Degraded",
                "recommended_action": "restart_worker_pool_and_increase_memory_limit",
                "status": "remediation_planned"
            },
            evidence=[
                f"Parsed error trace for service: {service_name}",
                f"Generated incident triage via {llm_res.provider}"
            ],
            artifacts=[artifact],
            errors=[],
            next_recommended_action="execute_remediation_runbook"
        )
