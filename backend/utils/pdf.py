import asyncio
import os
import subprocess
import sys
from functools import lru_cache

from loguru import logger

# Hard ceilings so a hung Chromium step can never outlive the ARQ job budget.
_INSTALL_TIMEOUT_S = 300
_BROWSER_START_TIMEOUT_S = 60
_PAGE_RENDER_TIMEOUT_S = 60


@lru_cache(maxsize=1)
def _browsers_present() -> bool:
    """True when a pre-baked Chromium already exists for this environment.

    Checks PLAYWRIGHT_BROWSERS_PATH first (the Docker image sets it to
    /ms-playwright), then the Playwright default cache dir. Avoids a
    blocking runtime download when the browser ships with the image.
    """
    candidates = []
    env_path = os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
    if env_path:
        candidates.append(env_path)
    candidates.append(os.path.join(os.path.expanduser("~"), ".cache", "ms-playwright"))
    for base in candidates:
        if os.path.isdir(base) and any(
            name.startswith("chromium") for name in os.listdir(base)
        ):
            return True
    return False


def _install_chromium_sync() -> bool:
    try:
        subprocess.run(
            [sys.executable, "-m", "playwright", "install", "chromium"],
            check=True,
            capture_output=True,
            timeout=_INSTALL_TIMEOUT_S,
        )
        return True
    except Exception as e:
        logger.warning(f"Playwright chromium install: {e}")
        return False


_browser_process_lock = asyncio.Lock()
_browser = None


async def _get_browser():
    global _browser
    if _browser is not None and _browser.is_connected():
        return _browser

    async with _browser_process_lock:
        if _browser is not None and _browser.is_connected():
            return _browser
        if not _browsers_present():
            # Off-loop install with a hard timeout; fail fast rather than hang.
            await asyncio.wait_for(
                asyncio.to_thread(_install_chromium_sync),
                timeout=_INSTALL_TIMEOUT_S,
            )
            _browsers_present.cache_clear()
        from playwright.async_api import async_playwright

        p = await asyncio.wait_for(
            async_playwright().start(), timeout=_BROWSER_START_TIMEOUT_S
        )
        _browser = await asyncio.wait_for(
            p.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-setuid-sandbox"],
            ),
            timeout=_BROWSER_START_TIMEOUT_S,
        )
        logger.info("Launched headless Chromium for PDF generation")
        return _browser


async def html_to_pdf(html_content: str, **pdf_options) -> bytes:
    browser = await _get_browser()
    page = await browser.new_page()
    try:
        await asyncio.wait_for(
            page.set_content(html_content, wait_until="networkidle"),
            timeout=_PAGE_RENDER_TIMEOUT_S,
        )
        pdf_bytes = await asyncio.wait_for(
            page.pdf(
                format="A4",
                print_background=True,
                margin={
                    "top": "20px",
                    "bottom": "20px",
                    "left": "20px",
                    "right": "20px",
                },
                **pdf_options,
            ),
            timeout=_PAGE_RENDER_TIMEOUT_S,
        )
        return pdf_bytes
    finally:
        await page.close()
