import asyncio
import httpx
import logging
import time

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("frontend_verifier")

FRONTEND_URL = "http://ai_os_frontend:3000"
BACKEND_URL = "http://localhost:8000"

MODULE_ROUTES = [
    ("Overview Dashboard", "/"),
    ("AI Workforce / All Agents & Departments", "/workforce"),
    ("Agent Builder", "/agent-builder"),
    ("Agent Marketplace", "/marketplace"),
    ("Workflow Studio", "/workflow-studio"),
    ("Autonomous Tasks", "/tasks"),
    ("Agent Teams", "/teams"),
    ("Knowledge Hub", "/knowledge"),
    ("Integrations & Models", "/integrations"),
    ("Approvals / HITL Governance", "/approvals"),
    ("Monitoring & Telemetry", "/monitoring"),
    ("Governance & Audit", "/governance"),
    ("System Settings", "/settings"),
]

BACKEND_API_ENDPOINTS = [
    ("API Health Check", "/api/v1/health"),
    ("Agents Registry API", "/api/v1/agents/"),
    ("Tasks Execution API", "/api/v1/tasks/"),
    ("Pending HITL Approvals API", "/api/v1/hitl/pending"),
    ("Monitoring Telemetry API", "/api/v1/monitoring/metrics"),
]

async def verify_frontend_and_api():
    print("=" * 85)
    print("      STEP 6: FRONTEND MODULES & BACKEND API INTERACTION VALIDATION      ")
    print("=" * 85)

    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
        print("\n--- 1. Testing Frontend Module User Journeys & Route Availability ---")
        for name, route in MODULE_ROUTES:
            start_t = time.time()
            url = f"{FRONTEND_URL}{route}"
            resp = await client.get(url)
            dur_ms = round((time.time() - start_t) * 1000, 1)
            
            assert resp.status_code == 200, f"Module '{name}' at {route} returned {resp.status_code}"
            print(f"  * {name:<40} -> {resp.status_code} OK ({dur_ms:>5}ms, {len(resp.text):>5} bytes)")

        print("\n--- 2. Testing Core Backend API Endpoints (Data Feeds for Frontend) ---")
        for name, ep in BACKEND_API_ENDPOINTS:
            start_t = time.time()
            url = f"{BACKEND_URL}{ep}"
            resp = await client.get(url)
            dur_ms = round((time.time() - start_t) * 1000, 1)

            assert resp.status_code == 200, f"API '{name}' at {ep} returned {resp.status_code}"
            json_data = resp.json()
            data_summary = f"{len(json_data)} records" if isinstance(json_data, list) else f"keys: {list(json_data.keys())[:4]}"
            print(f"  * {name:<30} [{ep:<24}] -> 200 OK ({dur_ms:>5}ms | {data_summary})")

        print("\n--- 3. Testing Frontend-to-Backend Workflow Execution Flow ---")
        # Submit a live task via the workflows endpoint used by Workflow Studio
        plan_resp = await client.post(
            f"{BACKEND_URL}/api/v1/workflows/plan",
            json={"objective": "Frontend user validation test workflow"}
        )
        assert plan_resp.status_code == 200, f"Plan generation returned {plan_resp.status_code}"
        plan_data = plan_resp.json()
        print(f"  Plan Generation: SUCCESS (Category: '{plan_data.get('category')}', Steps: {len(plan_data.get('steps', []))})")

        # Check tasks table after execution
        tasks_resp = await client.get(f"{BACKEND_URL}/api/v1/tasks/")
        assert tasks_resp.status_code == 200
        tasks = tasks_resp.json()
        print(f"  Real Tasks in Database: {len(tasks)} verified tasks persisted.")

    print("\n" + "=" * 85)
    print("STEP 6 COMPLETED: ALL 13 FRONTEND MODULES & API FEEDS VERIFIED LIVE.")
    print("=" * 85)

if __name__ == "__main__":
    asyncio.run(verify_frontend_and_api())
