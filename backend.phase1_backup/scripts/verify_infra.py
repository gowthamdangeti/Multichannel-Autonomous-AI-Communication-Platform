import asyncio
import io
import json
import logging
import time
import httpx
from sqlalchemy import text
from arq import create_pool
from arq.connections import RedisSettings
import redis.asyncio as aioredis
from minio import Minio

from app.config import settings
from app.database import async_session_maker, engine
from app.core.storage.minio_client import storage_client
from app.core.orchestrator.graph_engine import LangGraphWorkflowEngine
from app.schemas.orchestrator import ObjectiveSubmission

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("infra_validator")

async def test_postgres_read_write():
    print("\n--- 1. Testing PostgreSQL Read/Write ---")
    async with async_session_maker() as session:
        # Test write
        await session.execute(text("CREATE TEMP TABLE infra_test (id serial PRIMARY KEY, key text, val text);"))
        await session.execute(text("INSERT INTO infra_test (key, val) VALUES ('test_key', 'test_val');"))
        await session.commit()
        
        # Test read
        result = await session.execute(text("SELECT key, val FROM infra_test WHERE key = 'test_key';"))
        row = result.fetchone()
        assert row is not None, "PostgreSQL read failed: row is None"
        assert row[0] == 'test_key' and row[1] == 'test_val', f"PostgreSQL data mismatch: {row}"
        print(f"SUCCESS: PostgreSQL read/write verified. Row read back: {row[0]} = {row[1]}")
    return True

async def test_pgvector():
    print("\n--- 2. Testing pgvector Extension & Similarity Search ---")
    async with async_session_maker() as session:
        # Check extension
        ext_check = await session.execute(text("SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';"))
        ext_row = ext_check.fetchone()
        assert ext_row is not None, "pgvector extension not installed in postgres"
        print(f"pgvector extension detected: {ext_row[0]} version {ext_row[1]}")

        # Test vector distance calculation
        # L2 distance (<->) between [1, 2, 3] and [1, 2, 4] should be 1.0
        vec_query = await session.execute(text("SELECT '[1,2,3]'::vector <-> '[1,2,4]'::vector AS l2_dist, '[1,0,0]'::vector <=> '[0,1,0]'::vector AS cosine_dist;"))
        dist_row = vec_query.fetchone()
        l2_dist, cos_dist = dist_row[0], dist_row[1]
        print(f"L2 distance: {l2_dist}, Cosine distance: {cos_dist}")
        assert abs(l2_dist - 1.0) < 1e-5, f"pgvector L2 distance calculation incorrect: {l2_dist}"
        print("SUCCESS: pgvector extension and similarity queries verified.")
    return True

async def test_redis_operations():
    print("\n--- 3. Testing Redis Connection & Queue Operations ---")
    r = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    # Test ping
    pong = await r.ping()
    assert pong is True, f"Redis ping returned {pong}"
    
    # Test key-value set/get
    await r.set("test:infra:key", "enterprise_os_ready", ex=60)
    val = await r.get("test:infra:key")
    assert val == "enterprise_os_ready", f"Redis GET returned {val}"
    
    # Test list / queue push & pop
    q_name = "test:infra:queue"
    await r.delete(q_name)
    await r.rpush(q_name, "task_1", "task_2", "task_3")
    q_len = await r.llen(q_name)
    assert q_len == 3, f"Queue length expected 3, got {q_len}"
    
    item1 = await r.lpop(q_name)
    assert item1 == "task_1", f"Expected task_1, got {item1}"
    await r.delete(q_name)
    await r.aclose()
    print("SUCCESS: Redis connection, key-value, and queue operations verified.")
    return True

async def test_arq_worker_execution():
    print("\n--- 4. Testing ARQ Worker Execution ---")
    redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
    arq_pool = await create_pool(redis_settings)
    
    # Enqueue a real background job
    job = await arq_pool.enqueue_job("process_autonomous_objective", "Infrastructure verification test task")
    assert job is not None, "Failed to enqueue ARQ job"
    print(f"Enqueued ARQ job ID: {job.job_id}")
    
    # Poll for completion with a timeout
    start_time = time.time()
    job_result = None
    while time.time() - start_time < 30:
        info = await job.result_info()
        if info is not None:
            job_result = info.result
            break
        await asyncio.sleep(0.5)
        
    await arq_pool.aclose()
    assert job_result is not None, "ARQ job timed out or failed to execute on worker"
    print(f"SUCCESS: ARQ worker executed job. Workflow ID: {job_result.get('workflow_id')}, Status: {job_result.get('status')}")
    return True

async def test_minio_storage():
    print("\n--- 5. Testing MinIO Upload, Download & Artifact Retrieval ---")
    test_wf_id = f"wf-infra-test-{int(time.time())}"
    test_filename = "validation_report.json"
    test_content = json.dumps({"test": "minio_connectivity", "timestamp": time.time(), "status": "verified"})
    
    # Upload
    storage_path = await storage_client.upload_artifact(
        workflow_id=test_wf_id,
        filename=test_filename,
        content=test_content,
        content_type="application/json"
    )
    assert storage_path is not None, "MinIO upload failed"
    print(f"Artifact uploaded to MinIO path: {storage_path}")
    
    # Download / Retrieve
    retrieved_content = storage_client.get_artifact(workflow_id=test_wf_id, filename=test_filename)
    assert retrieved_content is not None, "MinIO artifact retrieval failed"
    parsed = json.loads(retrieved_content)
    assert parsed["test"] == "minio_connectivity", f"Content mismatch: {parsed}"
    print(f"SUCCESS: MinIO upload and artifact retrieval verified: {parsed['status']}")
    return True

async def test_langgraph_engine():
    print("\n--- 6. Testing LangGraph Execution Engine ---")
    engine = LangGraphWorkflowEngine()
    submission = ObjectiveSubmission(
        objective="Verify system architecture state transition in LangGraph engine"
    )
    # Execute graph state machine
    res = await engine.run_objective(submission)
    assert res is not None, "LangGraph execution returned None"
    assert res.get("status") == "completed", f"LangGraph execution status: {res.get('status')}"
    assert res.get("steps_count", 0) > 0, "No steps generated in LangGraph state"
    print(f"SUCCESS: LangGraph compiled state machine executed {res.get('steps_count')} nodes successfully.")
    return True

async def test_backend_api_health():
    print("\n--- 7. Testing Backend API Health ---")
    async with httpx.AsyncClient(base_url="http://localhost:8000", follow_redirects=True) as client:
        # /api/v1/health
        resp = await client.get("/api/v1/health")
        assert resp.status_code == 200, f"/api/v1/health returned {resp.status_code}"
        health_data = resp.json()
        print(f"/api/v1/health response: {health_data}")
        assert health_data.get("status") in ["healthy", "ok"]
        
        # /api/v1/agents/
        resp_agents = await client.get("/api/v1/agents/")
        assert resp_agents.status_code == 200, f"/api/v1/agents/ returned {resp_agents.status_code}"
        agents = resp_agents.json()
        print(f"/api/v1/agents count: {len(agents)}")
        assert len(agents) >= 12, f"Expected at least 12 agents, got {len(agents)}"
    print("SUCCESS: Backend API health and core endpoints verified.")
    return True

async def test_frontend_communication():
    print("\n--- 8. Testing Frontend-to-Backend API Communication ---")
    # From inside the container, frontend is accessible at http://ai_os_frontend:3000
    # Also verify frontend SSR/page response
    async with httpx.AsyncClient() as client:
        resp = await client.get("http://ai_os_frontend:3000", timeout=10.0)
        assert resp.status_code == 200, f"Frontend returned {resp.status_code}"
        print(f"Frontend HTTP response: {resp.status_code} OK (Content length: {len(resp.text)} bytes)")
        
        # Verify Next.js routes
        routes = ["/workforce", "/tasks", "/workflow-studio", "/approvals", "/monitoring"]
        for r in routes:
            r_resp = await client.get(f"http://ai_os_frontend:3000{r}", timeout=10.0)
            assert r_resp.status_code == 200, f"Route {r} returned {r_resp.status_code}"
            print(f"  Route http://ai_os_frontend:3000{r} -> {r_resp.status_code} OK")
    print("SUCCESS: Frontend service and route communication verified.")
    return True

async def main():
    print("=============================================================")
    print("    AUTONOMOUS AI OS - STEP 2 INFRASTRUCTURE VALIDATION      ")
    print("=============================================================")
    await test_postgres_read_write()
    await test_pgvector()
    await test_redis_operations()
    await test_arq_worker_execution()
    await test_minio_storage()
    await test_langgraph_engine()
    await test_backend_api_health()
    await test_frontend_communication()
    print("\n=============================================================")
    print("  ALL 8 INFRASTRUCTURE SERVICES FULLY OPERATIONAL & VERIFIED ")
    print("=============================================================")

if __name__ == "__main__":
    asyncio.run(main())
