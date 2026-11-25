# syntax=docker/dockerfile:1
# Multi-stage Dockerfile
# Stage 1: Builder - Install Python dependencies into a venv via uv
# (mirrors .devcontainer/Dockerfile's venv-builder stage).
FROM python:3.13-slim AS builder

WORKDIR /app

# Install git in builder stage (needed for any pip install from git URLs)
RUN apt-get update && apt-get install -y \
    git \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# uv (https://github.com/astral-sh/uv) for ~5-10x faster installs than pip.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

# Build the venv at the path it will live at in the final image, so shebangs
# and console-scripts inside the venv reference the correct runtime location
# after COPY --from.
ENV VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:$PATH
RUN python -m venv "$VIRTUAL_ENV"

# Layer 1: API deps. Cache invalidates only when requirements.txt changes.
RUN --mount=type=bind,source=api/requirements.txt,target=/tmp/req.txt \
    --mount=type=cache,target=/root/.cache/uv \
    uv pip install -r /tmp/req.txt

# Layer 2: pipecat deps. Cache invalidates when pipecat source changes.
# After installing pipecat, two hardening tweaks:
#   1. Swap opencv-python (pulled by pipecat[webrtc]) for opencv-python-headless.
#      The non-headless build links against X11/Qt (libxcb*); without those
#      shared libs in the image, `import cv2` fails at runtime.
#   2. Pre-download NLTK's punkt_tab tokenizer so pipecat's text processing
#      doesn't hit the network on first agent run. NLTK auto-finds it under
#      sys.prefix/nltk_data, so it travels with the venv on COPY.
RUN --mount=type=bind,source=pipecat,target=/tmp/pipecat,rw \
    --mount=type=cache,target=/root/.cache/uv \
    uv pip install '/tmp/pipecat[cartesia,deepgram,openai,elevenlabs,groq,google,azure,sarvam,soundfile,silero,webrtc,speechmatics,openrouter,camb,mcp]' \
 && uv pip uninstall opencv-python \
 && uv pip install opencv-python-headless \
 && python -c "import nltk; nltk.download('punkt_tab', download_dir='/opt/venv/nltk_data', quiet=True)"

# Strip cache files, test/example dirs, and some type stubs from the venv.
# NOTE: Only delete .pyi files that have a matching .py sibling (genuine type
# stubs). Never delete a .pyi that is the sole module entry point for its
# package (e.g. jinja2 on some platforms), which silently breaks imports.
RUN find /opt/venv -type f -name '*.pyc' -delete && \
    find /opt/venv -type d -name '__pycache__' -prune -exec rm -rf {} + && \
    find /opt/venv -type f -name '*.pyo' -delete && \
    find /opt/venv -type d \( -name tests -o -name test -o -name examples \) -prune -exec rm -rf {} + && \
    find /opt/venv -name '*.pyi' -exec sh -c 'f="${1%.pyi}"; [ -f "${f}.py" ]' _ {} \; -delete

# Stage 2: Playwright Chromium browser (headless) for PDF generation.
# Browsers are installed into /ms-playwright (PLAYWRIGHT_BROWSERS_PATH) and
# the same env var is set in the runner so the non-root `convozent` user can
# read them. The previous layout (/root/.cache/ms-playwright) was invisible
# to the runtime user, forcing a blocking runtime `playwright install` inside
# the event loop on every cold start.
FROM python:3.13-slim AS playwright-browser
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN pip install --no-cache-dir playwright>=1.52.0 \
 && python -m playwright install chromium \
 && find /ms-playwright -name 'node_modules' -prune -exec rm -rf {} + 2>/dev/null || true

# Stage 4: Node deps for ts_validator (built with full node:22-slim, only
# node_modules is copied into the runner).
FROM node:22-slim AS ts-deps
WORKDIR /ts_validator
COPY api/mcp_server/ts_validator/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Stage 5: Static ffmpeg binary (avoids apt ffmpeg pulling mesa/libllvm for
# hardware acceleration we don't use server-side).
#
# Resilient download: johnvansickle.com is the primary source but it's a single
# self-hosted host with no CDN and goes down intermittently. Use bounded-timeout
# retries, then fall back to BtbN/FFmpeg-Builds' rolling "latest" release. That
# release is continuously overwritten in place (unlike their date-stamped
# autobuild-* tags, which get pruned after a few weeks — a pinned autobuild
# tag WILL 404 eventually), so its checksum can't be hardcoded either; fetch
# the published checksums.sha256 alongside it and verify against that. Every
# archive is SHA256-verified before extraction. The two sources have different
# internal layouts, so locate the binaries with `find` rather than a fixed
# strip path.
FROM debian:trixie-slim AS ffmpeg-static
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates xz-utils \
    && rm -rf /var/lib/apt/lists/* \
    && case "${TARGETARCH}" in \
         amd64) \
           primary_url="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz" ; \
           primary_sha256="abda8d77ce8309141f83ab8edf0596834087c52467f6badf376a6a2a4c87cf67" ; \
           fallback_name="ffmpeg-master-latest-linux64-gpl.tar.xz" ; \
           ;; \
         arm64) \
           primary_url="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz" ; \
           primary_sha256="f4149bb2b0784e30e99bdda85471c9b5930d3402014e934a5098b41d0f7201b1" ; \
           fallback_name="ffmpeg-master-latest-linuxarm64-gpl.tar.xz" ; \
           ;; \
         *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
       esac \
    && fallback_url="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/${fallback_name}" \
    && checksums_url="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/checksums.sha256" \
    && mkdir -p /tmp/ffmpeg \
    && ok= \
    && echo "Downloading ffmpeg (primary) from ${primary_url}" \
    && if curl -fsSL --connect-timeout 20 --max-time 300 \
            --retry 3 --retry-delay 5 --retry-all-errors \
            -o /tmp/ffmpeg.tar.xz "${primary_url}" \
        && echo "${primary_sha256}  /tmp/ffmpeg.tar.xz" | sha256sum -c - ; then \
         ok=1 ; \
       else \
         rm -f /tmp/ffmpeg.tar.xz ; \
         echo "primary ffmpeg source failed, trying fallback: ${fallback_url}" >&2 ; \
         if curl -fsSL --connect-timeout 20 --max-time 300 \
                 --retry 3 --retry-delay 5 --retry-all-errors \
                 -o /tmp/checksums.sha256 "${checksums_url}" \
             && fallback_sha256="$(awk -v f="${fallback_name}" '$2 == f { print $1 }' /tmp/checksums.sha256)" \
             && [ -n "${fallback_sha256}" ] \
             && curl -fsSL --connect-timeout 20 --max-time 300 \
                 --retry 3 --retry-delay 5 --retry-all-errors \
                 -o /tmp/ffmpeg.tar.xz "${fallback_url}" \
             && echo "${fallback_sha256}  /tmp/ffmpeg.tar.xz" | sha256sum -c - ; then \
           ok=1 ; \
         fi ; \
       fi \
    && [ -n "${ok}" ] || { echo "all ffmpeg download sources failed" >&2 ; exit 1 ; } \
    && tar -xJf /tmp/ffmpeg.tar.xz -C /tmp/ffmpeg \
    && ffmpeg_bin="$(find /tmp/ffmpeg -type f -name ffmpeg | head -n1)" \
    && ffprobe_bin="$(find /tmp/ffmpeg -type f -name ffprobe | head -n1)" \
    && [ -n "${ffmpeg_bin}" ] && [ -n "${ffprobe_bin}" ] \
    && mv "${ffmpeg_bin}" "${ffprobe_bin}" /usr/local/bin/ \
    && chmod +x /usr/local/bin/ffmpeg /usr/local/bin/ffprobe \
    && rm -rf /tmp/ffmpeg /tmp/ffmpeg.tar.xz /tmp/checksums.sha256

# Stage 6: Runtime - Minimal image with only runtime dependencies
FROM python:3.13-slim AS runner

WORKDIR /app

# Install system libraries required by Chromium (no X11/Gtk — headless only)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 \
    libnspr4 \
    libatk1.0-0t64 \
    libatk-bridge2.0-0t64 \
    libcups2t64 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2t64 \
    libatspi2.0-0t64 \
    libx11-6 \
    libxext6 \
    libxcb1 \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system aios \
 && useradd --system --gid aios --no-log-init --home-dir /app --shell /usr/sbin/nologin aios \
 && chown aios:aios /app

# Static ffmpeg + ffprobe (used by audio_converter, audio_file_cache, etc.)
COPY --from=ffmpeg-static /usr/local/bin/ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg-static /usr/local/bin/ffprobe /usr/local/bin/ffprobe

# Node.js 22 binary only (ts_validator subprocess needs node >=22.6 for
# native TypeScript stripping; see api/mcp_server/ts_bridge.py). python:3.13-slim
# already provides libstdc++6, libgcc-s1, and ca-certificates that node needs.
COPY --from=node:22-slim /usr/local/bin/node /usr/local/bin/node

# Copy the populated venv from the builder stage. NLTK data lives at
# /opt/venv/nltk_data and is auto-discovered via sys.prefix.
COPY --from=builder /opt/venv /opt/venv

# Playwright Chromium browser for HTML-to-PDF generation.
# Copied to a world-readable path (PLAYWRIGHT_BROWSERS_PATH=/ms-playwright)
# so the non-root runtime user can launch it without a runtime install.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY --from=playwright-browser /ms-playwright /ms-playwright

# Activate the venv for subsequent RUN/CMD layers.
ENV VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:$PATH

# Set Python to not generate .pyc files in runtime
ENV PYTHONDONTWRITEBYTECODE=1
# Unbuffered output for better container logging
ENV PYTHONUNBUFFERED=1

# Copy application code (chown at copy-time avoids a duplicate /app layer
# from a later `RUN chown -R`, which would double the on-disk size of /app).
COPY --chown=aios:aios ./api ./api
COPY --chown=aios:aios ./scripts/start_services_docker.sh ./scripts/start_services_docker.sh

# ts_validator Node deps (built in ts-deps stage with full node:22-slim image).
# The validator runs as a short-lived subprocess from api/mcp_server/ts_bridge.py.
COPY --from=ts-deps --chown=aios:aios /ts_validator/node_modules ./api/mcp_server/ts_validator/node_modules

# Product documentation — read at runtime by the MCP docs tools
# (search_docs / fetch_doc) so agents can learn Autonomous AI OS.
COPY --chown=aios:aios ./docs ./docs

ENV PYTHONPATH=/app

# Disable file logging in Docker - logs go to stdout for docker logs
ENV LOG_TO_FILE=false

USER aios

# Expose the port FastAPI will run on
EXPOSE 8000

# Run the FastAPI app with uvicorn
CMD ["./scripts/start_services_docker.sh"]
