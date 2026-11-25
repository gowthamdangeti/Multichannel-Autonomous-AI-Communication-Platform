"""Website scraping tool for extracting content from web pages.

Uses httpx for fetching and BeautifulSoup for HTML parsing. No headless
browser — static HTML only. JS-rendered content is not captured.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup, Tag
from loguru import logger


class WebsiteScraperError(Exception):
    """Recoverable scraping error with context for the LLM."""

    def __init__(self, message: str, *, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


@dataclass
class ScrapeResult:
    """Result of a website scrape operation."""

    url: str
    title: str = ""
    text: str = ""
    links: list[dict[str, str]] = field(default_factory=list)
    error: Optional[str] = None
    truncated: bool = False


def _build_auth_headers(credential: Optional[dict] = None) -> dict[str, str]:
    """Build auth headers from a credential if provided."""
    headers = {}
    if not credential:
        return headers
    auth_type = credential.get("type", "")
    if auth_type == "bearer_token":
        token = credential.get("token") or credential.get("value", "")
        if token:
            headers["Authorization"] = f"Bearer {token}"
    elif auth_type == "api_key":
        key = credential.get("key", "X-API-Key")
        value = credential.get("value", "")
        if value:
            headers[key] = value
    elif auth_type == "basic_auth":
        import base64
        username = credential.get("username", "")
        password = credential.get("password", "")
        if username and password is not None:
            raw = f"{username}:{password}"
            encoded = base64.b64encode(raw.encode()).decode()
            headers["Authorization"] = f"Basic {encoded}"
    return headers


def _validate_url(url: str) -> str:
    """Validate and normalize a URL."""
    url = url.strip()
    if not url:
        raise WebsiteScraperError("URL must not be empty")
    if not url.startswith(("http://", "https://")):
        raise WebsiteScraperError(
            "URL must start with http:// or https://"
        )
    parsed = urlparse(url)
    if not parsed.netloc:
        raise WebsiteScraperError("URL appears invalid (no hostname)")
    return url


def _extract_full_text(soup: BeautifulSoup) -> str:
    """Extract all visible text from the page."""
    # Remove script, style, and hidden elements
    for tag in soup.find_all(["script", "style", "noscript", "nav", "footer"]):
        tag.decompose()

    text_parts: list[str] = []
    for element in soup.find_all(string=True):
        parent = element.parent
        if isinstance(parent, Tag):
            # Skip hidden elements
            style = parent.get("style", "")
            if "display:none" in style or "visibility:hidden" in style:
                continue
            # Skip empty whitespace
            stripped = element.strip()
            if stripped:
                text_parts.append(stripped)

    return "\n".join(text_parts)


def _extract_main_content(soup: BeautifulSoup) -> str:
    """Extract the primary content area using heuristics.

    Tries common selectors in order of specificity, falling back to
    full-text extraction.
    """
    # Remove script, style, nav, footer
    for tag in soup.find_all(["script", "style", "noscript", "nav"]):
        tag.decompose()

    # Candidate selectors ordered by specificity
    selectors = [
        "article",
        "[role='main']",
        "main",
        "#content",
        ".content",
        ".post-content",
        ".article-content",
        ".entry-content",
        "#main-content",
        ".main-content",
    ]

    for selector in selectors:
        container = soup.select_one(selector)
        if container and isinstance(container, Tag):
            text = container.get_text(separator="\n", strip=True)
            if len(text) > 200:
                return text

    # Fallback: find the largest text block in the body
    body = soup.find("body")
    if body:
        return body.get_text(separator="\n", strip=True)

    return _extract_full_text(soup)


def _extract_meta(soup: BeautifulSoup) -> tuple[str, str]:
    """Extract metadata from the page head."""
    title = ""
    description = ""

    title_tag = soup.find("title")
    if title_tag:
        title = title_tag.get_text(strip=True)

    # Open Graph title
    og_title = soup.find("meta", property="og:title")
    if og_title and og_title.get("content"):
        title = og_title["content"]

    meta_desc = soup.find("meta", attrs={"name": "description"})
    if meta_desc and meta_desc.get("content"):
        description = meta_desc["content"]

    og_desc = soup.find("meta", property="og:description")
    if og_desc and og_desc.get("content"):
        description = og_desc["content"]

    return title, description


def _extract_links(soup: BeautifulSoup, base_url: str) -> list[dict[str, str]]:
    """Extract all links from the page."""
    links: list[dict[str, str]] = []
    seen = set()

    for a_tag in soup.find_all("a", href=True):
        href = a_tag["href"]
        # Normalize relative URLs
        if href.startswith("/"):
            parsed = urlparse(base_url)
            href = f"{parsed.scheme}://{parsed.netloc}{href}"
        elif href.startswith("#"):
            continue
        elif not href.startswith(("http://", "https://")):
            continue

        if href not in seen:
            seen.add(href)
            text = a_tag.get_text(strip=True)
            links.append({"url": href, "text": text or "(link)"})

    return links


async def scrape_website(
    url: str,
    extraction_type: str = "main_content",
    include_links: bool = False,
    max_length: int = 8000,
    timeout_ms: int = 10000,
    credential: Optional[dict] = None,
) -> ScrapeResult:
    """Fetch a URL, parse the HTML, and return extracted content.

    Args:
        url: Target URL to scrape.
        extraction_type: 'full_text', 'main_content', or 'meta_only'.
        include_links: Whether to include links found on the page.
        max_length: Maximum characters of extracted text to return.
        timeout_ms: Request timeout in milliseconds.
        credential: Optional credential dict for auth headers.

    Returns:
        ScrapeResult with extracted content.

    Raises:
        WebsiteScraperError: On invalid URL, fetch failure, or parse error.
    """
    logger.info(f"Scraping URL: {url} (extraction={extraction_type})")

    try:
        url = _validate_url(url)
    except WebsiteScraperError:
        raise

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (compatible; ConvozentWebsiteScraper/1.0; "
            "+https://convozent.com)"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
    }
    headers.update(_build_auth_headers(credential))

    try:
        async with httpx.AsyncClient(timeout=timeout_ms / 1000.0, follow_redirects=True) as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
    except httpx.TimeoutException:
        raise WebsiteScraperError(
            f"Request to {url} timed out after {timeout_ms}ms"
        )
    except httpx.HTTPStatusError as e:
        raise WebsiteScraperError(
            f"HTTP {e.response.status_code} error fetching {url}"
        )
    except httpx.RequestError as e:
        raise WebsiteScraperError(f"Failed to fetch {url}: {e}")

    content_type = response.headers.get("content-type", "")
    if "text/html" not in content_type and "application/xhtml" not in content_type:
        raise WebsiteScraperError(
            f"URL did not return HTML (content-type: {content_type})"
        )

    try:
        soup = BeautifulSoup(response.text, "lxml")
    except Exception as e:
        raise WebsiteScraperError(f"Failed to parse HTML: {e}")

    title = ""
    description = ""

    if extraction_type == "meta_only":
        title, description = _extract_meta(soup)
        meta_text = f"Title: {title}\nDescription: {description}" if description else f"Title: {title}"
        text = meta_text
    elif extraction_type == "full_text":
        title, description = _extract_meta(soup)
        text = _extract_full_text(soup)
    else:
        # main_content (default)
        title, description = _extract_meta(soup)
        text = _extract_main_content(soup)
        # If main content extraction didn't yield much, fall back
        if len(text.strip()) < 100:
            text = _extract_full_text(soup)

    # Clean up excessive whitespace
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = text.strip()

    truncated = len(text) > max_length
    if truncated:
        text = text[:max_length] + "\n\n[... content truncated]"

    # Build result
    links = []
    if include_links:
        links = _extract_links(soup, url)

    result = ScrapeResult(
        url=url,
        title=title,
        text=text,
        links=links,
        truncated=truncated,
    )

    logger.info(
        f"Scraped {url}: {len(text)} chars, {len(links)} links, "
        f"truncated={truncated}"
    )
    return result