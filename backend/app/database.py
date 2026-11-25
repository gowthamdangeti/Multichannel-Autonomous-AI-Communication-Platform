import logging
from typing import AsyncGenerator
from sqlalchemy import text, select
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from app.config import settings

logger = logging.getLogger(__name__)

Base = declarative_base()

try:
    engine = create_async_engine(
        settings.DATABASE_URL,
        echo=False,
        future=True,
        pool_pre_ping=True
    )
    async_session_maker = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False
    )
except Exception as e:
    logger.warning(f"Could not initialize async database engine: {e}")
    engine = None
    async_session_maker = None

async def init_db():
    """Ensure database schema, pgvector extensions, and default records exist."""
    if engine is None or async_session_maker is None:
        logger.warning("Database engine not available for initialization.")
        return

    # Import models to ensure they are registered with Base.metadata
    import app.models  # noqa: F401
    from app.models.organization import Organization
    from app.models.user import User

    async with engine.begin() as conn:
        await conn.execute(text('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";'))
        await conn.execute(text('CREATE EXTENSION IF NOT EXISTS vector;'))
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database schema and extensions verified.")

    async with async_session_maker() as session:
        # Seed default organization if absent
        result = await session.execute(select(Organization).where(Organization.id == "org-default"))
        default_org = result.scalar_one_or_none()
        if not default_org:
            default_org = Organization(
                id="org-default",
                name="Autonomous AI Enterprise",
                slug="default",
                description="Default primary autonomous enterprise tenant",
                is_active=True,
                settings={"retention_days": 90, "max_concurrent_agents": 50}
            )
            session.add(default_org)
            await session.commit()
            logger.info("Created default enterprise organization [org-default].")

        # Seed default admin user if absent
        user_result = await session.execute(select(User).where(User.email == "admin@autonomous.ai"))
        if not user_result.scalar_one_or_none():
            admin_user = User(
                id="user-admin-01",
                org_id="org-default",
                email="admin@autonomous.ai",
                hashed_password="argon2-hashed-placeholder-dev-admin",
                full_name="Platform Administrator",
                role="admin",
                is_active=True,
                is_superuser=True,
                permissions=["*"]
            )
            session.add(admin_user)
            await session.commit()
            logger.info("Seeded initial admin user account [admin@autonomous.ai].")

        # Sync registry agents into database
        from app.core.agents.registry import registry
        from app.models.agent import AgentModel
        for agent in registry.list_all():
            agent_res = await session.execute(select(AgentModel).where(AgentModel.slug == agent.slug))
            existing_agent = agent_res.scalar_one_or_none()
            if not existing_agent:
                db_agent = AgentModel(
                    id=f"agent-{agent.slug}",
                    org_id="org-default",
                    name=agent.name,
                    slug=agent.slug,
                    department=agent.department,
                    role=agent.role,
                    description=agent.description,
                    system_prompt=agent.system_prompt,
                    model_provider=agent.model_provider,
                    model_name=agent.model_name,
                    status="idle",
                    autonomy_level="autonomous",
                    capabilities=agent.capabilities,
                    tools=agent.tools,
                    is_active=True,
                    success_rate=100.0,
                    total_tasks_completed=0.0,
                    average_duration_ms=0.0
                )
                session.add(db_agent)
        await session.commit()
        logger.info("Synced registered agents into PostgreSQL.")

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    if async_session_maker is None:
        raise RuntimeError("Database session maker is not configured.")
    async with async_session_maker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
