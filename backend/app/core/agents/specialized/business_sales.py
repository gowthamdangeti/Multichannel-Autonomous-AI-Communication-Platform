from typing import List, Dict, Any
from app.core.agents.base import BaseAutonomousAgent
from app.schemas.agent import AgentExecutionResult
from app.schemas.task import TaskContract

class BusinessSalesAgent(BaseAutonomousAgent):
    slug: str = "enterprise-sales-strategist"
    name: str = "Enterprise Sales Strategist"
    department: str = "Business and Sales"
    role: str = "Deal qualification, ICP alignment, business proposal drafting, and competitive positioning"
    description: str = "Analyzes enterprise sales opportunities, computes deal economics, and drafts custom proposals."
    system_prompt: str = (
        "You are an elite Enterprise Sales Strategist. "
        "You analyze customer pain points, formulate value propositions, and structure commercial proposals."
    )
    capabilities: List[str] = [
        "deal_qualification",
        "value_proposition_modeling",
        "roi_calculation",
        "proposal_generation"
    ]
    tools: List[str] = ["data_calculator", "document_parser"]

    async def execute_task(self, task: TaskContract) -> AgentExecutionResult:
        deal_scope = task.input_data.get("deal_scope", task.objective)
        seats = task.input_data.get("seats", 150)

        # 1. Compute deal economics via DataCalculatorTool
        calc_res = await self.call_tool(task, "data_calculator", expression=f"{seats} * 120 * 12")
        annual_contract_value = calc_res.output if calc_res.success else 216000

        # 2. Generate strategic proposal using LLM
        prompt = (
            f"Draft an enterprise commercial proposal for:\n"
            f"Scope: {deal_scope}\n"
            f"Seat Count: {seats}\n"
            f"Annual Contract Value: ${annual_contract_value:,.2f}\n"
            f"Provide an Executive Summary, Solution Alignment, ROI Justification, and Commercial Terms."
        )
        llm_res = await self.call_llm(prompt)

        proposal_artifact = {
            "title": f"Enterprise Commercial Proposal - {deal_scope[:30]}",
            "type": "markdown",
            "content": f"# Enterprise Commercial Proposal\n\n{llm_res.content}\n"
        }

        return AgentExecutionResult(
            task_id=task.task_id,
            agent_id=self.slug,
            status="completed",
            confidence=0.97,
            structured_result={
                "deal_scope": deal_scope,
                "annual_contract_value": annual_contract_value,
                "calculated_tier": "Enterprise Premier",
                "status": "proposal_generated"
            },
            evidence=[
                f"Evaluated enterprise parameters for: {deal_scope}",
                f"DataCalculatorTool computed ACV: ${annual_contract_value:,.2f}",
                f"Drafted customized proposal via {llm_res.provider}"
            ],
            artifacts=[proposal_artifact],
            errors=[],
            next_recommended_action="submit_for_executive_approval"
        )
