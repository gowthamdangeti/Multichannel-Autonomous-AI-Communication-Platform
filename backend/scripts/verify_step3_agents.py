import asyncio
import json
import logging
import time
import uuid
from datetime import datetime, timezone
from sqlalchemy import text, select

from app.database import async_session_maker
from app.core.agents.registry import registry
from app.core.tools.registry import tool_registry
from app.schemas.task import TaskContract
from app.schemas.agent import AgentExecutionResult
from app.models.agent import AgentModel
from app.models.task import TaskModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("agent_verifier")

TEST_TASKS = {
    "senior-researcher": {
        "objective": "Investigate next-generation autonomous AI orchestration architectures and comparative benchmarks",
        "input_data": {"query": "Autonomous agent orchestration frameworks 2026", "depth": "comprehensive"},
        "permissions": ["read", "web_search", "document_parser"]
    },
    "lead-software-architect": {
        "objective": "Design and implement high-performance event loop worker processor with resilient error recovery",
        "input_data": {"language": "python", "pattern": "event_driven_worker", "include_tests": True},
        "permissions": ["read", "write", "code_sandbox", "ast_parser"]
    },
    "communications-director": {
        "objective": "Draft an executive briefing and stakeholder communication regarding autonomous OS deployment",
        "input_data": {"audience": "C-Suite & Board", "tone": "authoritative", "key_highlights": ["zero-downtime", "99.9% reliability"]},
        "permissions": ["read", "write"]
    },
    "enterprise-sales-strategist": {
        "objective": "Analyze enterprise deal parameters, calculate ACV for 250 enterprise seats, and generate commercial proposal",
        "input_data": {"deal_scope": "Autonomous AI OS Global Deployment", "seats": 250},
        "permissions": ["read", "data_calculator", "document_parser"]
    },
    "principal-data-analyst": {
        "objective": "Analyze operational dataset metrics, statistical distribution, and compute throughput percentiles",
        "input_data": {"metric": "latency_p99", "sample_size": 5000, "aggregation": "percentile"},
        "permissions": ["read", "data_calculator"]
    },
    "knowledge-graph-curator": {
        "objective": "Extract entity relationships and construct semantic knowledge nodes from technical specification",
        "input_data": {"content": "Autonomous agents interact via message brokers and store episodic context in vector indices.", "domain": "agentic_systems"},
        "permissions": ["read", "document_parser"]
    },
    "process-automation-engineer": {
        "objective": "Synthesize automated integration pipeline DAG connecting webhook triggers, data validation, and ERP sync",
        "input_data": {"trigger": "order_placed", "targets": ["erp_connector", "slack_notifier"], "sla_seconds": 15},
        "permissions": ["read", "code_sandbox"]
    },
    "procurement-finance-auditor": {
        "objective": "Audit enterprise cloud infrastructure invoice against allocated budget and compute variance",
        "input_data": {"budget": 50000.0, "quoted_price": 41250.0, "vendor": "Cloud Provider Global"},
        "permissions": ["read", "data_calculator"]
    },
    "site-reliability-engineer": {
        "objective": "Evaluate cluster telemetry, latency SLIs, error budget burn rate, and formulate remediation playbook",
        "input_data": {"cluster": "production-us-east-1", "sli_target": 99.95, "current_sli": 99.92},
        "permissions": ["read", "code_sandbox"]
    },
    "growth-marketing-strategist": {
        "objective": "Develop multi-channel enterprise go-to-market messaging and thought leadership campaign",
        "input_data": {"product_tier": "Autonomous Enterprise", "channels": ["LinkedIn", "TechCrunch", "Direct Executive Outreach"]},
        "permissions": ["read", "write"]
    },
    "security-governance-officer": {
        "objective": "Conduct least-privilege permission audit, data residency checks, and SOC2 compliance evaluation",
        "input_data": {"permissions_requested": ["read", "write", "deploy_staging"], "classification": "restricted"},
        "permissions": ["read", "security_eval"]
    },
    "model-eval-optimization-lead": {
        "objective": "Evaluate multi-agent reasoning trace quality, hallucination metrics, and output alignment",
        "input_data": {"eval_criteria": ["factual_consistency", "instruction_following", "latency"], "sample_runs": 25},
        "permissions": ["read", "model_evaluator"]
    }
}

async def verify_all_agents():
    print("=" * 80)
    print("       STEP 3: DEEP VERIFICATION OF ALL 12 AGENT DEPARTMENTS         ")
    print("=" * 80)

    agents = registry.list_all()
    print(f"Total Agents Registered in Memory Registry: {len(agents)}")
    assert len(agents) == 12, f"Expected 12 agents, got {len(agents)}"

    verification_records = []

    async with async_session_maker() as session:
        # Load all DB agents to link agent_id
        db_agents_res = await session.execute(select(AgentModel))
        db_agents = {a.slug: a.id for a in db_agents_res.scalars().all()}

        for agent in agents:
            print(f"\n[{agent.department}] -> Agent: '{agent.name}' (slug: {agent.slug})")
            
            # 1. Implementation checks
            assert agent.slug, "Agent slug is empty"
            assert agent.name, "Agent name is empty"
            assert agent.department, "Agent department is empty"
            assert agent.role, "Agent role is empty"
            
            # 2. System Instructions
            assert len(agent.system_prompt) > 20, f"System prompt too short for {agent.slug}"
            print(f"  - System Prompt: {agent.system_prompt[:65]}...")

            # 3. Model Provider Configuration
            assert agent.model_provider in ["openai", "gemini", "anthropic", "groq", "deepseek", "openrouter"], f"Invalid provider {agent.model_provider}"
            print(f"  - Model Provider: {agent.model_provider} / Model: {agent.model_name}")

            # 4. Available Tools
            print(f"  - Declared Tools: {agent.tools}")
            for t_name in agent.tools:
                t = tool_registry.get(t_name)
                assert t is not None, f"Tool '{t_name}' declared by agent '{agent.slug}' not found in tool_registry!"
            
            # 5. Execute realistic task
            task_def = TEST_TASKS.get(agent.slug)
            if not task_def:
                task_def = {
                    "objective": f"Execute standard domain operation for {agent.department}",
                    "input_data": {"scope": "baseline_verification"},
                    "permissions": ["read", "write"]
                }
            
            contract = TaskContract(
                task_id=f"test-exec-{uuid.uuid4().hex[:8]}",
                assigned_agent=agent.slug,
                objective=task_def["objective"],
                input_data=task_def["input_data"],
                permissions=task_def["permissions"],
                constraints=["Adhere to enterprise governance", "Response within 15 seconds"]
            )

            start_t = time.time()
            result: AgentExecutionResult = await agent.run(contract)
            duration_ms = round((time.time() - start_t) * 1000, 2)

            # 6. Validate Output
            assert result.status == "completed", f"Agent {agent.slug} failed with status: {result.status}"
            assert result.confidence >= 0.8, f"Agent {agent.slug} confidence too low: {result.confidence}"
            assert len(result.evidence) >= 1, f"Agent {agent.slug} returned no evidence"
            assert len(result.artifacts) >= 1, f"Agent {agent.slug} produced no artifacts"
            assert isinstance(result.structured_result, dict), f"Agent {agent.slug} structured_result not dict"
            assert len(result.errors) == 0, f"Agent {agent.slug} reported errors: {result.errors}"

            print(f"  - EXECUTION SUCCESS ({duration_ms}ms) | Confidence: {result.confidence} | Evidence: {len(result.evidence)} items | Artifacts: {len(result.artifacts)}")
            print(f"  - Artifact 0: {result.artifacts[0].get('title', 'Untitled')} ({result.artifacts[0].get('type', 'text')})")

            # 7. Persist execution record in PostgreSQL
            db_agent_id = db_agents.get(agent.slug)
            task_record = TaskModel(
                id=contract.task_id,
                agent_id=db_agent_id,
                title=f"Verification: {agent.name}",
                objective=contract.objective,
                status="completed",
                priority="medium",
                input_data=contract.input_data,
                output_data={
                    "structured_result": result.structured_result,
                    "evidence": result.evidence,
                    "artifacts_count": len(result.artifacts)
                },
                constraints=contract.constraints,
                permissions=contract.permissions,
                confidence=result.confidence,
                execution_metadata={
                    "duration_ms": duration_ms,
                    "model_provider": agent.model_provider,
                    "model_name": agent.model_name,
                    "verified_at": datetime.now(timezone.utc).isoformat()
                }
            )
            session.add(task_record)

            verification_records.append({
                "slug": agent.slug,
                "name": agent.name,
                "department": agent.department,
                "provider": f"{agent.model_provider}:{agent.model_name}",
                "tools": agent.tools,
                "task_id": contract.task_id,
                "status": result.status,
                "confidence": result.confidence,
                "duration_ms": duration_ms,
                "artifacts_produced": len(result.artifacts)
            })

        await session.commit()
        print("\nAll 12 task execution records successfully committed to PostgreSQL 'tasks' table.")

    print("\n" + "=" * 105)
    print(f"{'DEPARTMENT':<38} | {'AGENT SLUG':<28} | {'TASK ID':<18} | {'CONF':<5} | {'TIME':<8} | {'STATUS'}")
    print("-" * 105)
    for rec in verification_records:
        print(f"{rec['department']:<38} | {rec['slug']:<28} | {rec['task_id']:<18} | {rec['confidence']:<5} | {rec['duration_ms']:<6}ms | {rec['status']}")
    print("=" * 105)
    print("STEP 3 COMPLETED: ALL 12 AGENTS REAL-TASK EXECUTED, VALIDATED & PERSISTED.")

if __name__ == "__main__":
    asyncio.run(verify_all_agents())
