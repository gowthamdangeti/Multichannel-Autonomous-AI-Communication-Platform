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
    tools: List[str] = ["document_parser"]

    async def execute_task(self, task: TaskContract) -> AgentExecutionResult:
        source_data = task.input_data.get("source_data", {})
        audience = task.input_data.get("audience", "Executive Leadership")

        # 1. Format executive briefing with LLM
        prompt = (
            f"Draft an executive briefing memo for: {audience}\n"
            f"Objective: {task.objective}\n"
            f"Context: {task.input_data}\n\n"
            f"Include an Executive Summary, Key Milestones Achieved, and Concrete Action Items."
        )
        llm_res = await self.call_llm(prompt)

        # 2. Verify deliverable structure with DocumentParserTool
        doc_result = await self.call_tool(task, "document_parser", content=llm_res.content, doc_type="markdown")

        deliverable = {
            "title": f"Executive Memo: {task.objective[:45]}",
            "type": "executive_memo",
            "content": f"# Executive Briefing\n\n**Audience:** {audience}\n\n{llm_res.content}\n"
        }

        return AgentExecutionResult(
            task_id=task.task_id,
            agent_id=self.slug,
            status="completed",
            confidence=0.98,
            structured_result={
                "audience": audience,
                "document_sections": doc_result.output.get("headings", []) if doc_result.success else [],
                "status": "ready_for_distribution"
            },
            evidence=[
                f"Generated strategic memo tailored for: {audience}",
                f"DocumentParserTool structural verification: {'PASSED' if doc_result.success else 'FAILED'}",
                f"Generated via {llm_res.provider} ({llm_res.model})"
            ],
            artifacts=[deliverable],
            errors=[],
            next_recommended_action="distribute_or_await_approval"
        )
