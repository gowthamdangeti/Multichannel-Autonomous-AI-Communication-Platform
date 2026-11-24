# Autonomous AI OS - API Reference

Base URL: `/api/v1`

## Endpoints

### Health & System Readiness
- `GET /health`: Comprehensive status of core engine, agent registry, and dependent services.
- `GET /health/live`: Kubernetes / Docker liveness probe.
- `GET /health/ready`: Kubernetes / Docker readiness probe.

### Autonomous Workflows & Orchestrator
- `POST /workflows/plan`: Generates a decomposed execution plan without running it.
  - **Body**: `{ "objective": string, "constraints": string[] }`
  - **Response**: `ExecutionPlan`
- `POST /workflows/execute`: Decomposes and executes the objective autonomously end-to-end.
  - **Body**: `{ "objective": string, "constraints": string[] }`
  - **Response**: `WorkflowResult` with artifacts, step telemetry, and confidence scores.

### Agent Workforce Registry
- `GET /agents`: List all registered autonomous agents.
- `GET /agents/{slug}`: Fetch specific agent profile, system prompts, capabilities, and tools.
- `POST /agents/{slug}/execute`: Dispatch a `TaskContract` directly to a specific agent.

### Tasks
- `GET /tasks`: List recent task contracts and execution states.

### Frontier Models & Providers
- `GET /models`: List configured LLM reasoning providers (OpenAI, Gemini, Anthropic, Groq, DeepSeek).

### Telemetry & Monitoring
- `GET /monitoring/metrics`: Return real-time platform telemetry and agent error rates.

### Real-Time Streaming
- `WS /ws`: WebSocket stream for live agent task status updates and heartbeats.
