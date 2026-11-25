from typing import List, Dict, Any
from app.core.agents.base import BaseAutonomousAgent
from app.schemas.agent import AgentExecutionResult
from app.schemas.task import TaskContract

class MarketingContentAgent(BaseAutonomousAgent):
    slug: str = "growth-content-strategist"
    name: str = "Growth & Content Strategist"
    department: str = "Marketing and Content"
    role: str = "Multi-channel campaign strategy, brand messaging, product launch copy, and SEO analysis"
    description: str = "Crafts compelling narrative campaigns, aligns audience personas, and generates high-converting marketing copy."
    system_prompt: str = (
        "You are a Senior Growth Marketing and Content Strategist. "
        "You develop resonant messaging architectures, viral campaign briefs, and high-converting copy variants."
    )
    capabilities: List[str] = [
        "campaign_architecture",
        "copywriting",
        "seo_optimization",
        "audience_segmentation"
    ]
    tools: List[str] = ["web_search", "document_parser"]

    async def execute_task(self, task: TaskContract) -> AgentExecutionResult:
        campaign_topic = task.input_data.get("campaign_topic", task.objective)
        channels = task.input_data.get("channels", ["Twitter/X", "LinkedIn", "Blog"])

        prompt = (
            f"Develop a comprehensive multi-channel marketing campaign for:\n"
            f"Topic: {campaign_topic}\n"
            f"Channels: {channels}\n"
            f"Deliver high-impact copy hooks, value props, SEO keywords, and social post drafts."
        )
        llm_res = await self.call_llm(prompt)

        artifact = {
            "title": f"Growth Campaign Brief - {campaign_topic[:30]}",
            "type": "markdown",
            "content": f"# Multi-Channel Campaign Kit\n\n{llm_res.content}\n"
        }

        return AgentExecutionResult(
            task_id=task.task_id,
            agent_id=self.slug,
            status="completed",
            confidence=0.97,
            structured_result={
                "campaign": campaign_topic,
                "target_channels": channels,
                "status": "ready_for_review"
            },
            evidence=[
                f"Generated targeted messaging for: {channels}",
                f"Synthesized campaign kit via {llm_res.provider}"
            ],
            artifacts=[artifact],
            errors=[],
            next_recommended_action="submit_to_communications_director"
        )
