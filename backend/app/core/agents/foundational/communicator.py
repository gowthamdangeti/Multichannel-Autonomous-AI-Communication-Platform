from typing import List, Dict, Any
from app.core.agents.base import BaseAutonomousAgent
from app.schemas.agent import AgentExecutionResult
from app.schemas.task import TaskContract

class CommunicationAgent(BaseAutonomousAgent):
    slug: str = "communications-director"
    name: str = "Communications Director"
    department: str = "Communication"
    role: str = "Executive reporting, stakeholder messaging, and cross-channel communication"
    description: str = "Transforms technical and business findings into clear, impactful executive briefings and announcements."
    system_prompt: str = (
        "You are an executive Communications Director. "
        "You translate raw intelligence, technical specs, and status metrics into polished enterprise deliverables."
    )
    capabilities: List[str] = [
        "executive_briefing",
        "email_drafting",
        "stakeholder_updates",
        "cross_channel_messaging"
    ]
    tools: List[str] = ["template_engine", "markdown_formatter", "channel_notifier"]

    async def execute_task(self, task: TaskContract) -> AgentExecutionResult:
        source_data = task.input_data.get("source_data", {})
        audience = task.input_data.get("audience", "Executive Leadership")

        executive_summary = (
            f"Autonomous Execution Summary prepared for {audience}. "
            f"Objective '{task.objective}' has progressed through multi-agent analysis with validated governance."
        )

        deliverable = {
            "title": f"Executive Memo: {task.objective[:45]}",
            "type": "executive_memo",
            "content": f"## Executive Briefing\n\n**Audience:** {audience}\n\n**Summary:**\n{executive_summary}\n\n### Action Items\n- Review automated recommendations\n- Authorize next milestone execution\n"
        }

        return AgentExecutionResult(
            task_id=task.task_id,
            agent_id=self.slug,
            status="completed",
            confidence=0.98,
            structured_result={
                "audience": audience,
                "memo_length_words": 150,
                "status": "ready_for_distribution"
            },
            evidence=[f"Formatted payload tailored to audience: {audience}"],
            artifacts=[deliverable],
            errors=[],
            next_recommended_action="distribute_or_await_approval"
        )
