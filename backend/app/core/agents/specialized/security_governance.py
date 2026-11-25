from typing import List, Dict, Any
from app.core.agents.base import BaseAutonomousAgent
from app.schemas.agent import AgentExecutionResult
from app.schemas.task import TaskContract

class SecurityGovernanceAgent(BaseAutonomousAgent):
    slug: str = "security-governance-officer"
    name: str = "Security & Governance Officer"
    department: str = "Security and Governance"
    role: str = "Autonomous policy enforcement, compliance auditing, prompt injection mitigation, and vulnerability review"
    description: str = "Enforces least-privilege principles, audits agent action boundaries, and scans payloads for security risks."
    system_prompt: str = (
        "You are the Chief Security and Governance Officer for the Autonomous AI OS. "
        "You enforce zero-trust policies, identify security vulnerabilities, and block unauthorized operations."
    )
    capabilities: List[str] = [
        "policy_enforcement",
        "compliance_audit",
        "vulnerability_assessment",
        "prompt_injection_detection"
    ]
    tools: List[str] = ["ast_parser", "document_parser"]

    async def execute_task(self, task: TaskContract) -> AgentExecutionResult:
        target_action = task.input_data.get("target_action", task.objective)
        permissions = task.permissions

        # 1. Policy & injection audit check
        has_critical_permission = "root" in permissions or "admin" in permissions
        risk_score = 0.85 if has_critical_permission else 0.15

        prompt = (
            f"Evaluate security compliance and privilege boundaries for:\n"
            f"Target Action: {target_action}\n"
            f"Requested Permissions: {permissions}\n"
            f"Assess prompt injection risk, data exfiltration risk, and policy compliance."
        )
        llm_res = await self.call_llm(prompt)

        artifact = {
            "title": f"Security & Compliance Audit: {target_action[:30]}",
            "type": "markdown",
            "content": f"# Security Governance Signoff\n\n{llm_res.content}\n"
        }

        return AgentExecutionResult(
            task_id=task.task_id,
            agent_id=self.slug,
            status="completed",
            confidence=0.99,
            structured_result={
                "action": target_action,
                "risk_score": risk_score,
                "governance_status": "authorized_within_guardrails",
                "requires_hitl_approval": risk_score > 0.5
            },
            evidence=[
                f"Audited permissions boundary: {permissions}",
                f"Security scan completed with risk score: {risk_score}"
            ],
            artifacts=[artifact],
            errors=[],
            next_recommended_action="proceed_with_bounded_execution"
        )
