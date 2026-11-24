# Autonomous AI OS - Agent Workforce Catalogue

The platform features an autonomous workforce organized across 12 enterprise departments:

| Department | Agent Slug | Default Model | Capabilities | Primary Tools |
| :--- | :--- | :--- | :--- | :--- |
| **Research & Intelligence** | `senior-researcher` | GPT-4o / Gemini 1.5 Pro | Web search, market intelligence, fact verification | `web_search`, `document_scraper`, `knowledge_query` |
| **Communication** | `communications-director` | GPT-4o / Claude 3.5 Sonnet | Executive briefing, stakeholder memo, channel broadcast | `template_engine`, `markdown_formatter`, `channel_notifier` |
| **Software Engineering** | `lead-software-architect` | Claude 3.5 Sonnet / GPT-4o | System design, code generation, verification, AST analysis | `ast_parser`, `code_linter`, `test_runner`, `sandbox_executor` |
| **Data & Analytics** | `principal-data-analyst` | GPT-4o / Gemini 1.5 Pro | Quantitative modeling, anomaly detection, telemetry KPIs | `sql_query`, `pandas_engine`, `chart_builder` |

---

## Agent Lifecycle

Every agent implements `BaseAutonomousAgent` and conforms to two strict Pydantic contracts:

1. **Input Task Contract (`TaskContract`)**:
   - `task_id`
   - `parent_task_id`
   - `workflow_id`
   - `assigned_agent`
   - `objective`
   - `input_data`
   - `constraints`
   - `permissions`
   - `success_criteria`
   - `deadline`
   - `execution_metadata`

2. **Output Result Contract (`AgentExecutionResult`)**:
   - `task_id`
   - `agent_id`
   - `status`
   - `structured_result`
   - `confidence`
   - `evidence`
   - `artifacts`
   - `errors`
   - `next_recommended_action`
