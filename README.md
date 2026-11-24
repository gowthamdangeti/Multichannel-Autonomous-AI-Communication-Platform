# Autonomous AI OS

An enterprise-grade Autonomous Multi-Agent AI Operating System capable of managing a complete digital workforce of specialized AI agents.

```
USER REQUEST → UNDERSTANDING → PLANNING → AGENT SELECTION → WORKFLOW GENERATION → AUTONOMOUS EXECUTION → VERIFICATION → RECOVERY → COMPLETION → LEARNING
```

---

## 🚀 Key Highlights & Capabilities

- **Master Orchestrator**: LangGraph-inspired stateful planner and dependency resolver.
- **Dynamic Workflow Engine**: Decomposes natural language requests into parallel and sequential dependency graphs.
- **Foundational Autonomous Workforce**:
  - `senior-researcher` (Research and Intelligence)
  - `communications-director` (Executive Synthesis & Delivery)
  - `lead-software-architect` (Clean Architecture & Code Generation)
  - `principal-data-analyst` (Quantitative Modeling & Telemetry)
- **Controlled Autonomy & Governance**: Deterministic policy boundaries, human-in-the-loop signoffs for high-impact actions, and tamper-evident audit logs.
- **Error Recovery Pipeline**: Automatic error classification, exponential backoff retries, capability matching fallbacks, and dead-letter handling.
- **Multi-Tier Memory & Knowledge**:
  - Working Memory (Redis)
  - Semantic & Vector Knowledge (PostgreSQL + pgvector)
  - Artifact Storage (MinIO S3-compatible store)
- **Enterprise Dark-Mode Web Console**: Next.js 14, Tailwind CSS, TypeScript, and live telemetry.

---

## 📁 Repository Structure

```
autonomous-ai-os/
├── backend/                  # FastAPI Application, SQLAlchemy models, Agent Runtime
│   ├── app/
│   │   ├── api/v1/           # API endpoints (health, agents, workflows, tasks, models)
│   │   ├── core/             # Orchestrator, Agents, Recovery, Runtime, Governance
│   │   ├── models/           # SQLAlchemy ORM models
│   │   ├── schemas/          # Pydantic v2 contracts
│   │   └── workers/          # ARQ background queue worker
│   └── requirements.txt
├── frontend/                 # Next.js 14 TypeScript Frontend
│   ├── src/
│   │   ├── app/              # Enterprise Pages (Overview, Workforce, Workflow Studio, etc.)
│   │   ├── components/       # UI Components & Visualizer
│   │   └── lib/              # API Client & Zustand Store
│   └── package.json
├── infrastructure/           # Database scripts & storage init
│   └── postgres/init.sql
├── docker/                   # Dockerfiles for Backend, Worker, and Frontend
├── docs/                     # Architectural specs, API documentation, Agent catalogue
├── tests/                    # Backend unit and integration tests
├── docker-compose.yml        # Orchestration for Postgres+pgvector, Redis, MinIO, Backend, Frontend
└── .env.example              # Environment variables template
```

---

## 🛠️ Quick Start

### 1. Prerequisites
- Docker & Docker Compose
- Node.js 18+ (for local frontend development)
- Python 3.11+ (for local backend development)

### 2. Environment Setup
```bash
cp .env.example .env
```

### 3. Start with Docker Compose
```bash
docker-compose up --build
```

Services will be accessible at:
- **Frontend Dashboard**: [http://localhost:3000](http://localhost:3000)
- **Backend API & Swagger Docs**: [http://localhost:8000/api/v1/docs](http://localhost:8000/api/v1/docs)
- **Backend Health Check**: [http://localhost:8000/api/v1/health](http://localhost:8000/api/v1/health)
- **MinIO Console**: [http://localhost:9001](http://localhost:9001)

### 4. Running Backend Locally
```bash
cd backend
python -m venv venv
# Windows:
.\venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 5. Running Frontend Locally
```bash
cd frontend
npm install
npm run dev
```

---

## 🧪 Testing

Run backend tests:
```bash
pytest tests/backend/
```

---

## 📜 License
Enterprise Proprietary - Autonomous AI OS Core.
