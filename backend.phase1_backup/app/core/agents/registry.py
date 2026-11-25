import logging
from typing import Dict, List, Optional, Type
from app.core.agents.base import BaseAutonomousAgent
from app.core.agents.foundational.researcher import ResearchAgent
from app.core.agents.foundational.communicator import CommunicationAgent
from app.core.agents.foundational.coder import SoftwareEngineerAgent
from app.core.agents.foundational.analyst import DataAnalystAgent
from app.core.agents.specialized.business_sales import BusinessSalesAgent
from app.core.agents.specialized.document_knowledge import DocumentKnowledgeAgent
from app.core.agents.specialized.workflow_automation import WorkflowAutomationAgent
from app.core.agents.specialized.finance_procurement import FinanceProcurementAgent
from app.core.agents.specialized.it_operations import ITOperationsAgent
from app.core.agents.specialized.marketing_content import MarketingContentAgent
from app.core.agents.specialized.security_governance import SecurityGovernanceAgent
from app.core.agents.specialized.evaluation_optimization import EvaluationOptimizationAgent

logger = logging.getLogger(__name__)

class AgentRegistry:
    """
    Central enterprise registry for discovering, instantiating, and orchestrating
    autonomous agents across all 12 enterprise departments.
    """
    _agents: Dict[str, BaseAutonomousAgent] = {}

    @classmethod
    def register(cls, agent_instance: BaseAutonomousAgent):
        cls._agents[agent_instance.slug] = agent_instance
        logger.info(f"Registered agent: {agent_instance.slug} [{agent_instance.department}]")

    @classmethod
    def get(cls, slug: str) -> Optional[BaseAutonomousAgent]:
        return cls._agents.get(slug)

    @classmethod
    def list_all(cls) -> List[BaseAutonomousAgent]:
        return list(cls._agents.values())

    @classmethod
    def find_by_department(cls, department: str) -> List[BaseAutonomousAgent]:
        return [a for a in cls._agents.values() if a.department.lower() == department.lower()]

    @classmethod
    def find_best_match(cls, required_capabilities: List[str]) -> Optional[BaseAutonomousAgent]:
        """Find the agent with the highest capability overlap."""
        best_agent = None
        highest_score = -1
        req_set = set(c.lower() for c in required_capabilities)

        for agent in cls._agents.values():
            agent_caps = set(c.lower() for c in agent.capabilities)
            overlap = len(req_set.intersection(agent_caps))
            if overlap > highest_score:
                highest_score = overlap
                best_agent = agent

        return best_agent if highest_score > 0 else (cls._agents.get("senior-researcher") or next(iter(cls._agents.values()), None))

# Initialize with agents across all 12 specialized departments
registry = AgentRegistry()
registry.register(ResearchAgent())                        # 1. Research and Intelligence
registry.register(SoftwareEngineerAgent())                # 2. Software Engineering
registry.register(CommunicationAgent())                   # 3. Communication
registry.register(BusinessSalesAgent())                   # 4. Business and Sales
registry.register(DataAnalystAgent())                     # 5. Data and Analytics
registry.register(DocumentKnowledgeAgent())               # 6. Document and Knowledge Intelligence
registry.register(WorkflowAutomationAgent())              # 7. Workflow Automation
registry.register(FinanceProcurementAgent())              # 8. Finance and Procurement
registry.register(ITOperationsAgent())                    # 9. IT Operations
registry.register(MarketingContentAgent())                # 10. Marketing and Content
registry.register(SecurityGovernanceAgent())              # 11. Security and Governance
registry.register(EvaluationOptimizationAgent())          # 12. Autonomous Evaluation and Optimization
