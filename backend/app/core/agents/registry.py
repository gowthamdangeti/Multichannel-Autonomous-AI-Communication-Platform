import logging
from typing import Dict, List, Optional, Type
from app.core.agents.base import BaseAutonomousAgent
from app.core.agents.foundational.researcher import ResearchAgent
from app.core.agents.foundational.communicator import CommunicationAgent
from app.core.agents.foundational.coder import SoftwareEngineerAgent
from app.core.agents.foundational.analyst import DataAnalystAgent

logger = logging.getLogger(__name__)

class AgentRegistry:
    """
    Central registry for discovering, instantiating, and orchestrating
    autonomous agents across all enterprise departments.
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

# Initialize with foundational agents
registry = AgentRegistry()
registry.register(ResearchAgent())
registry.register(CommunicationAgent())
registry.register(SoftwareEngineerAgent())
registry.register(DataAnalystAgent())
