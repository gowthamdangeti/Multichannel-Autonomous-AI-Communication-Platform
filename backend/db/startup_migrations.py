"""Apply pending Alembic migrations when the API starts (opt-in).

Alembic's env.py calls ``asyncio.run()`` and reconfigures logging, so it runs
in a child process instead of inside the server's event loop. ``subprocess.run``
runs on a worker thread because asyncio subprocesses are unavailable on the
Windows selector event loop.
"""

import asyncio
import os
import subprocess
import sys

from loguru import logger

from api.constants import APP_ROOT_DIR

_PROJECT_ROOT = APP_ROOT_DIR.parent
_ALEMBIC_INI = APP_ROOT_DIR / "alembic.ini"


def _upgrade_head() -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["PYTHONPATH"] = os.pathsep.join(
        p for p in (str(_PROJECT_ROOT), env.get("PYTHONPATH", "")) if p
    )
    return subprocess.run(
        [sys.executable, "-m", "alembic", "-c", str(_ALEMBIC_INI), "upgrade", "head"],
        cwd=_PROJECT_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,  # returncode is inspected so alembic's output gets logged
    )


async def run_startup_migrations() -> None:
    """Upgrade the database to head; raise so startup fails loudly on error."""
    logger.info("RUN_MIGRATIONS_ON_STARTUP=true: running alembic upgrade head")
    result = await asyncio.to_thread(_upgrade_head)
    output = "\n".join(s for s in (result.stdout, result.stderr) if s).strip()
    if result.returncode != 0:
        logger.error(f"Alembic migration failed:\n{output}")
        raise RuntimeError("Database migration failed on startup; see log above.")
    applied = [line for line in output.splitlines() if "Running upgrade" in line]
    if applied:
        for line in applied:
            logger.info(line.split("] ", 1)[-1])
    else:
        logger.info("Database schema already at head")
