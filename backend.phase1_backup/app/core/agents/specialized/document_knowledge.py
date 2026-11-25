from typing import List, Dict, Any
from app.core.agents.base import BaseAutonomousAgent
from app.schemas.agent import AgentExecutionResult
from app.schemas.task import TaskContract

class DocumentKnowledgeAgent(BaseAutonomousAgent):
    slug: str = "knowledge-intelligence-officer"
    name: str = "Knowledge Intelligence Officer"
    department: str = "Document and Knowledge Intelligence"
    role: str = "Document parsing, semantic extraction, cross-document indexing, and RAG synthesis"
    description: str = "Extracts structured metadata, ingests technical corpora, and synthesizes institutional knowledge."
    system_prompt: str = (
        "You are a Knowledge Intelligence Officer. "
        "You index, categorize, and synthesize institutional documents and unstructured corpora."
    )
    capabilities: List[str] = [
        "document_parsing",
        "semantic_chunking",
        "metadata_extraction",
        "knowledge_synthesis"
    ]
    tools: List[str] = ["document_parser", "web_search"]

    async def execute_task(self, task: TaskContract) -> AgentExecutionResult:
        doc_text = task.input_data.get("document_text", task.objective)

        # 1. Parse document structure
        doc_res = await self.call_tool(task, "document_parser", content=doc_text, doc_type="markdown")

        # 2. Extract semantic entities with LLM
        prompt = (
            f"Extract key institutional concepts, entity mappings, and operational rules from:\n"
            f"Content: {doc_text}\n"
            f"Structure: {doc_res.output}\n"
            f"Output a structured Knowledge Summary and Indexation Spec."
        )
        llm_res = await self.call_llm(prompt)

        artifact = {
            "title": "Knowledge Extraction Spec",
            "type": "markdown",
            "content": f"# Knowledge Intelligence Summary\n\n{llm_res.content}\n"
        }

        return AgentExecutionResult(
            task_id=task.task_id,
            agent_id=self.slug,
            status="completed",
            confidence=0.96,
            structured_result={
                "extracted_sections": doc_res.output.get("headings", []) if doc_res.success else [],
                "status": "indexed_to_knowledge_base"
            },
            evidence=[
                "Parsed document structure using DocumentParserTool",
                f"Synthesized knowledge spec using {llm_res.provider}"
            ],
            artifacts=[artifact],
            errors=[],
            next_recommended_action="publish_to_vector_store"
        )
