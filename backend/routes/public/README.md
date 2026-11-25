# Convozent Public API Endpoints

This directory contains the public API routers and handlers for Convozent.

## Comprehensive API Documentation

For the full detailed documentation of every public API endpoint, including authentication, HTTP methods, request/response JSON schemas, query parameters, error codes, and cURL examples, see:

👉 **[`PUBLIC_API_DOCUMENTATION.md`](PUBLIC_API_DOCUMENTATION.md)**

---

## Overview of Public Routers

- **`agent.py`**:
  - `router` (`/public/agent`): Agent lifecycle (creation, listing, fetching, updating, publishing, drafting, deleting), outbound call triggers, text chat sessions, ambient noise uploads, and run reports.
  - `public_workflow_router` (`/public/workflow`): Workflow-scoped run detail access.
  - `public_organization_router` (`/public/organizations`): Organization usage history, current period quota, daily breakdown, and CSV report export.
- **`public_embed.py`** (`/public/embed`): Public WebRTC voice widget initialization, widget config, TURN relay credentials, and embedded web chat widget endpoints.
- **`public_download.py`** (`/public/download`): Secure public token downloads for call audio recordings (`.wav`/`.mp3`) and transcripts.
