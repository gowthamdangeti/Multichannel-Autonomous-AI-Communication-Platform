# Convozent Public API Documentation

This document provides complete, detailed reference documentation for all public API endpoints in Convozent. These endpoints allow external integrations, web widgets, and automation scripts to interact with Convozent conversational AI agents, trigger telephony calls, manage agent definitions, run text chat sessions, access usage metrics, export reports, and embed WebRTC widgets.

---

## Table of Contents

1. [Authentication & Base Setup](#1-authentication--base-setup)
2. [Agent Trigger & Call Initiation Endpoints](#2-agent-trigger--call-initiation-endpoints)
3. [Agent Management & Lifecycle Endpoints](#3-agent-management--lifecycle-endpoints)
4. [Agent Templates & AI Generation Endpoints](#4-agent-templates--ai-generation-endpoints)
5. [Text Chat Session Endpoints](#5-text-chat-session-endpoints)
6. [Workflow Runs & Execution History Endpoints](#6-workflow-runs--execution-history-endpoints)
7. [Organization Usage & Analytics Endpoints](#7-organization-usage--analytics-endpoints)
8. [Reports & Export Endpoints](#8-reports--export-endpoints)
9. [Media & Ambient Noise Upload Endpoints](#9-media--ambient-noise-upload-endpoints)
10. [Public Embed & WebRTC Widget Endpoints](#10-public-embed--webrtc-widget-endpoints)
11. [Public Artifact Download Endpoints](#11-public-artifact-download-endpoints)
12. [Telephony Configuration & Phone Number Endpoints](#12-telephony-configuration--phone-number-endpoints)
13. [WhatsApp Channel Public Endpoints](#13-whatsapp-channel-public-endpoints)

---

## 1. Authentication & Base Setup

Most public endpoints require API Key authentication associated with your Convozent organization.

### Request Headers
- **`X-API-Key`** (required for authenticated routes): Your organization API Key (e.g. `cz_live_...`).
- **`Content-Type`**: `application/json` (for `POST`, `PUT`, `PATCH` requests).

### Base URL
```http
https://your-api-domain.com
```

---

## 2. Agent Trigger & Call Initiation Endpoints

### 2.1 Initiate Outbound Call by Trigger Path
**`POST /public/agent/{trigger_path}`** or **`POST /public/agent/{uuid}`**

**Purpose**: Triggers a production outbound AI call for an agent configured with the given trigger path / UUID.

- **Headers**: `X-API-Key: <your_api_key>`
- **Path Parameters**:
  - `trigger_path` / `uuid` (string, required): The unique trigger path / UUID assigned to the agent trigger node.
- **Request Body**:
```json
{
  "phone_number": "+15551234567",
  "initial_context": {
    "customer_name": "John Doe",
    "account_id": "ACC-12345"
  },
  "telephony_configuration_id": null
}
```
- **Response (`200 OK`)**:
```json
{
  "status": "initiated",
  "workflow_run_id": 501,
  "workflow_run_name": "WR-API-8492"
}
```
- **Error Responses**:
  - `401 Unauthorized`: Invalid API Key.
  - `404 Not Found`: Trigger path not found, inactive, or workflow not active.
  - `402 Payment Required`: Organization has exceeded call quota.
- **cURL Example**:
```bash
curl -X POST "https://your-api-domain.com/public/agent/trigger-uuid-123" \
  -H "X-API-Key: cz_live_secret_key" \
  -H "Content-Type: application/json" \
  -d '{
    "phone_number": "+15551234567",
    "initial_context": {"customer_name": "John Doe"}
  }'
```

---

### 2.2 Initiate Test / Draft Call by Trigger Path
**`POST /public/agent/test/{trigger_path}`** or **`POST /public/agent/test/{uuid}`**

**Purpose**: Initiates a call using the agent's current unpublished **draft** definition rather than the released production version. Ideal for sandbox testing.

- **Headers**: `X-API-Key: <your_api_key>`
- **Path Parameters**: `trigger_path` / `uuid` (string)
- **Request Body**: Same as [`TriggerCallRequest`](#21-initiate-outbound-call-by-trigger-path).
- **Response (`200 OK`)**:
```json
{
  "status": "initiated",
  "workflow_run_id": 502,
  "workflow_run_name": "WR-TEST-1923"
}
```

---

### 2.3 Initiate Outbound Call by Workflow UUID
**`POST /public/agent/workflow/{workflow_uuid}`**

**Purpose**: Triggers an outbound call directly using the agent's main `workflow_uuid`.

- **Headers**: `X-API-Key: <your_api_key>`
- **Path Parameters**:
  - `workflow_uuid` (string, required): The UUID of the agent workflow.
- **Request Body**: Same as [`TriggerCallRequest`](#21-initiate-outbound-call-by-trigger-path).
- **Response (`200 OK`)**:
```json
{
  "status": "initiated",
  "workflow_run_id": 503,
  "workflow_run_name": "WR-API-9102"
}
```

---

### 2.4 Initiate Test Call by Workflow UUID
**`POST /public/agent/test/workflow/{workflow_uuid}`**

**Purpose**: Initiates a test call using the draft version of the workflow identified by its `workflow_uuid`.

- **Headers**: `X-API-Key: <your_api_key>`
- **Path Parameters**: `workflow_uuid` (string)
- **Request Body**: Same as [`TriggerCallRequest`](#21-initiate-outbound-call-by-trigger-path).
- **Response (`200 OK`)**:
```json
{
  "status": "initiated",
  "workflow_run_id": 504,
  "workflow_run_name": "WR-TEST-4481"
}
```

---

### 2.5 Schedule / Retrigger Future Call
**`POST /public/agent/follow-up`**

**Purpose**: Schedules a durable future retrigger/follow-up call based on scheduled time, offset delay, or specific timezone configuration.

- **Headers**: `X-API-Key: <your_api_key>`
- **Request Body**:
```json
{
  "phone_number": "+15551234567",
  "scheduled_at": "2026-09-18T15:00:00Z",
  "initial_context": {
    "reminder_type": "appointment_confirm"
  },
  "idempotency_key": "unique_booking_99182"
}
```
- **Response (`200 OK`)**:
```json
{
  "status": "scheduled",
  "scheduled_call_id": 12,
  "scheduled_at": "2026-09-18T15:00:00Z"
}
```

---

## 3. Agent Management & Lifecycle Endpoints

### 3.1 Create Public Agent
**`POST /public/agent`** or **`POST /public/agent/create`**

**Purpose**: Programmatically creates a new agent workflow within your organization.

- **Headers**: `X-API-Key: <your_api_key>`
- **Request Body**:
```json
{
  "name": "Customer Support Assistant",
  "description": "Handles tier-1 support queries",
  "system_prompt": "You are a helpful customer support agent for Acme Inc.",
  "call_type": "outbound",
  "folder_id": null
}
```
- **Response (`200 OK`)**:
```json
{
  "workflow_id": 101,
  "workflow_uuid": "wflow_a1b2c3d4",
  "name": "Customer Support Assistant",
  "status": "draft",
  "trigger_path": "trig_x9y8z7",
  "created_at": "2026-09-17T12:00:00Z",
  "folder_id": null
}
```

---

### 3.2 List Public Agents
**`GET /public/agent`** (Aliases: `/public/agent/list`, `/public/agent/fetch`)

**Purpose**: Lists all agents in your organization with optional pagination, status, and folder filtering.

- **Headers**: `X-API-Key: <your_api_key>`
- **Query Parameters**:
  - `page` (int, default `1`): Page number.
  - `limit` (int, default `20`, max `100`): Results per page.
  - `status` (string, optional): Filter by status (`active`, `archived`, `draft`).
  - `folder_id` (int, optional): Filter by folder ID.
  - `search` (string, optional): Search by agent name.
- **Response (`200 OK`)**:
```json
{
  "agents": [
    {
      "workflow_id": 101,
      "workflow_uuid": "wflow_a1b2c3d4",
      "name": "Customer Support Assistant",
      "status": "active",
      "trigger_path": "trig_x9y8z7",
      "created_at": "2026-09-17T12:00:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20
}
```

---

### 3.3 Fetch Agent Details
**`GET /public/agent/{identifier}`** (Aliases: `/public/agent/details/{identifier}`, `POST /public/agent/fetch/{identifier}`, `GET /public/agent/fetch/{identifier}`)

**Purpose**: Fetches complete details, configuration, and flow graph for a specific agent identified by numeric ID, `workflow_uuid`, or `trigger_path`.

- **Headers**: `X-API-Key: <your_api_key>`
- **Path Parameters**: `identifier` (int or string)
- **Response (`200 OK`)**: Same schema as [`CreatePublicAgentResponse`](#31-create-public-agent).

---

### 3.4 Update Public Agent
**`PUT /public/agent/{identifier}`** (Aliases: `PATCH /public/agent/{identifier}`, `PUT /public/agent/update/{identifier}`)

**Purpose**: Updates agent properties, system prompt, or canvas workflow node definition.

- **Headers**: `X-API-Key: <your_api_key>`
- **Request Body**:
```json
{
  "name": "Updated Customer Support Assistant",
  "system_prompt": "Updated system prompt...",
  "workflow_definition": { ... }
}
```
- **Response (`200 OK`)**: Updated agent object.

---

### 3.5 Update Agent Status
**`PUT /public/agent/{identifier}/status`**

**Purpose**: Changes agent lifecycle status between `active` and `archived`.

- **Headers**: `X-API-Key: <your_api_key>`
- **Request Body**:
```json
{
  "status": "archived"
}
```
- **Response (`200 OK`)**: Updated agent object with new status.

---

### 3.6 Delete Public Agent
**`DELETE /public/agent/{identifier}`**

**Purpose**: Permanently soft-deletes/archives an agent.

- **Headers**: `X-API-Key: <your_api_key>`
- **Response (`200 OK`)**:
```json
{
  "message": "Agent deleted successfully",
  "workflow_id": 101
}
```

---

### 3.7 Publish Agent Version
**`POST /public/agent/{identifier}/publish`**

**Purpose**: Releases the current draft workflow graph definition to production so new calls use the latest changes.

- **Headers**: `X-API-Key: <your_api_key>`
- **Response (`200 OK`)**:
```json
{
  "message": "Agent published successfully",
  "workflow_id": 101,
  "published_version_id": 3
}
```

---

### 3.8 Create Agent Draft
**`POST /public/agent/{identifier}/create-draft`**

**Purpose**: Creates an editable draft version from the published agent state.

- **Headers**: `X-API-Key: <your_api_key>`
- **Response (`200 OK`)**: Draft creation details.

---

### 3.9 Get Agent Versions
**`GET /public/agent/{identifier}/versions`**

**Purpose**: Retrieves release history and version logs for an agent.

- **Headers**: `X-API-Key: <your_api_key>`
- **Response (`200 OK`)**: List of agent versions with release timestamps.

---

### 3.10 Duplicate Agent
**`POST /public/agent/duplicate`** or **`POST /public/agent/duplicate/{identifier}`**

**Purpose**: Clones an existing agent workflow under your organization.

- **Headers**: `X-API-Key: <your_api_key>`
- **Request Body**:
```json
{
  "workflow_id": 101,
  "name": "Customer Support Copy"
}
```
- **Response (`200 OK`)**: The newly created duplicate agent object.

---

### 3.11 Update Agent Folder Assignment
**`PUT /public/agent/{identifier}/folder`**

**Purpose**: Assigns or moves an agent into an organization folder.

- **Headers**: `X-API-Key: <your_api_key>`
- **Request Body**:
```json
{
  "folder_id": 5
}
```
- **Response (`200 OK`)**: Agent details with updated `folder_id`.

---

### 3.12 Validate Agent Workflow Graph
**`POST /public/agent/validate`** or **`POST /public/agent/{identifier}/validate`**

**Purpose**: Validates the node connections and schema of an agent workflow definition for structural errors before publishing.

- **Headers**: `X-API-Key: <your_api_key>`
- **Request Body**: `{"workflow_definition": { ... }}`
- **Response (`200 OK`)**:
```json
{
  "valid": true,
  "errors": []
}
```

---

## 4. Agent Templates & AI Generation Endpoints

### 4.1 List Agent Templates
**`GET /public/agent/templates`**

**Purpose**: Retrieves standard pre-configured industry templates (e.g. appointment booking, real estate qualifier, survey bot).

- **Headers**: `X-API-Key: <your_api_key>`
- **Response (`200 OK`)**: List of template objects.

---

### 4.2 Create Agent from Template
**`POST /public/agent/templates/{template_id}/duplicate`** (Aliases: `/public/agent/create/template/{template_id}`, `/public/agent/templates/duplicate`)

**Purpose**: Instantiates a new workspace agent pre-populated from a template.

- **Headers**: `X-API-Key: <your_api_key>`
- **Path Parameters**: `template_id` (int)
- **Request Body**:
```json
{
  "workflow_name": "My Inbound Booking Agent"
}
```
- **Response (`200 OK`)**: New agent object created from template.

---

## 5. Text Chat Session Endpoints

These endpoints support interactive text-based simulation and web text chat with agents.

### 5.1 Create Text Chat Session
**`POST /public/agent/{identifier}/text-chat/sessions`**

**Purpose**: Initializes a new interactive text chat session with an agent.

- **Headers**: `X-API-Key: <your_api_key>`
- **Request Body**:
```json
{
  "name": "Web Chat Customer 1",
  "initial_context": {
    "user_email": "user@example.com"
  }
}
```
- **Response (`200 OK`)**:
```json
{
  "session_id": "session_88192",
  "workflow_run_id": 701,
  "initial_message": "Hello! How can I help you today?"
}
```

---

### 5.2 Get Text Chat Session State
**`GET /public/agent/{identifier}/text-chat/sessions/{run_id}`**

**Purpose**: Fetches message history, state checkpoints, and pending turn status for a text chat session.

- **Headers**: `X-API-Key: <your_api_key>`
- **Response (`200 OK`)**: Complete message transcript and revision counter.

---

### 5.3 Send Text Chat Message
**`POST /public/agent/{identifier}/text-chat/sessions/{run_id}/messages`**

**Purpose**: Appends a user message to an active chat session and processes the AI response turn.

- **Headers**: `X-API-Key: <your_api_key>`
- **Request Body**:
```json
{
  "text": "What are your business hours?",
  "expected_revision": 2
}
```
- **Response (`200 OK`)**: Updated session state containing the AI's reply message.

---

### 5.4 Rewind Text Chat Session
**`POST /public/agent/{identifier}/text-chat/sessions/{run_id}/rewind`**

**Purpose**: Rewinds conversation state back to a previous turn cursor.

- **Headers**: `X-API-Key: <your_api_key>`
- **Request Body**:
```json
{
  "cursor_turn_id": "turn_3",
  "expected_revision": 4
}
```
- **Response (`200 OK`)**: Rewound transcript state.

---

## 6. Workflow Runs & Execution History Endpoints

### 6.1 List Agent Workflow Runs
**`GET /public/agent/{identifier}/runs`**

**Purpose**: Fetches call execution run history for a specific agent with pagination.

- **Headers**: `X-API-Key: <your_api_key>`
- **Query Parameters**:
  - `page` (int, default `1`): Page number.
  - `limit` (int, default `20`): Page size.
  - `status` (string, optional): Filter by run status (`completed`, `failed`, `in_progress`).
- **Response (`200 OK`)**: List of run summaries.

---

### 6.2 Get Run Details
**`GET /public/agent/runs/{run_id}`** or **`GET /public/agent/{identifier}/runs/{run_id}`**

**Purpose**: Retrieves full execution metadata, duration, call disposition, costs, audio recording links, and transcript for a call run.

- **Headers**: `X-API-Key: <your_api_key>`
- **Response (`200 OK`)**:
```json
{
  "id": 501,
  "workflow_id": 101,
  "mode": "twilio",
  "status": "completed",
  "duration_seconds": 142,
  "cost": 0.084,
  "recording_url": "https://your-api-domain.com/public/download/workflow/token123/recording",
  "transcript_url": "https://your-api-domain.com/public/download/workflow/token123/transcript",
  "created_at": "2026-09-17T12:05:00Z"
}
```

---

### 6.3 Get Workflow Run Details by Workflow ID
**`GET /public/workflow/{workflow_id}/runs/{run_id}`**

**Purpose**: Direct workflow-scoped run lookup endpoint.

- **Headers**: `X-API-Key: <your_api_key>`
- **Response (`200 OK`)**: Same run details object.

---

## 7. Organization Usage & Analytics Endpoints

### 7.1 Get Public Agent Count
**`GET /public/agent/count`**

**Purpose**: Returns total count of agents broken down by status.

- **Headers**: `X-API-Key: <your_api_key>`
- **Response (`200 OK`)**:
```json
{
  "total": 12,
  "active": 10,
  "archived": 2
}
```

---

### 7.2 Get Public Agents Summary
**`GET /public/agent/summary`**

**Purpose**: Returns aggregate organization dashboard metrics (total call count, total duration minutes, active agent count).

- **Headers**: `X-API-Key: <your_api_key>`
- **Response (`200 OK`)**:
```json
{
  "total_agents": 12,
  "total_runs": 1450,
  "total_duration_minutes": 320.5
}
```

---

### 7.3 Get Usage History Runs
**`GET /public/agent/organizations/usage/runs`** (Aliases: `/public/agent/organization/usage/runs`, `/public/organizations/usage/runs`, `/public/agent/usage/runs`)

**Purpose**: Returns paginated billing and call usage history across all agents in the organization.

- **Headers**: `X-API-Key: <your_api_key>`
- **Query Parameters**:
  - `page` (int, default `1`)
  - `limit` (int, default `20`)
  - `start_date` (string, optional): ISO date filter.
  - `end_date` (string, optional): ISO date filter.
- **Response (`200 OK`)**: Paginated list of usage runs with cost breakdowns.

---

### 7.4 Get Current Period Usage Quotas
**`GET /public/agent/organizations/usage/current-period`** (Aliases: `/public/agent/organization/usage/current-period`, `/public/organizations/usage/current-period`, `/public/agent/usage/current-period`)

**Purpose**: Returns current billing cycle call minutes used vs plan limits.

- **Headers**: `X-API-Key: <your_api_key>`
- **Response (`200 OK`)**:
```json
{
  "period_start": "2026-09-01T00:00:00Z",
  "period_end": "2026-10-01T00:00:00Z",
  "minutes_used": 420,
  "minutes_limit": 1000,
  "percentage_used": 42.0
}
```

---

### 7.5 Get Daily Usage Breakdown
**`GET /public/agent/organizations/usage/daily-breakdown`** (Aliases: `/public/agent/organization/usage/daily-breakdown`, `/public/organizations/usage/daily-breakdown`, `/public/agent/usage/daily-breakdown`)

**Purpose**: Returns day-by-day analytics of call volume and minutes spent.

- **Headers**: `X-API-Key: <your_api_key>`
- **Response (`200 OK`)**: Array of daily usage records.

---

## 8. Reports & Export Endpoints

### 8.1 Export Usage History CSV Report
**`GET /public/agent/organizations/usage/runs/report`** (Aliases: `/public/agent/organization/usage/runs/report`, `/public/organizations/usage/runs/report`, `/public/agent/usage/runs/report`)

**Purpose**: Generates and downloads a CSV spreadsheet report of all call usage records.

- **Headers**: `X-API-Key: <your_api_key>`
- **Response (`200 OK`)**: File download (`Content-Type: text/csv`).

---

### 8.2 Get Run Single Report Metadata
**`GET /public/agent/{identifier}/runs/{run_id}/report`**

**Purpose**: Fetches report availability and summary for a single call run.

- **Headers**: `X-API-Key: <your_api_key>`
- **Response (`200 OK`)**: Report metadata object.

---

### 8.3 Download Agent CSV Report
**`GET /public/agent/{identifier}/report/download`** (Aliases: `/public/agent/{identifier}/report`)

**Purpose**: Downloads a CSV export of all runs for a specific agent.

- **Headers**: `X-API-Key: <your_api_key>`
- **Response (`200 OK`)**: File download (`Content-Type: text/csv`).

---

### 8.4 Download Agent PDF Reports (ZIP)
**`GET /public/agent/{identifier}/report/download/pdf`** (Aliases: `/public/agent/{identifier}/report/pdf`)

**Purpose**: Generates Jinja2-rendered PDF summary reports for every completed run of the agent and returns a ZIP archive download.

- **Headers**: `X-API-Key: <your_api_key>`
- **Response (`200 OK`)**: File download (`Content-Type: application/zip`).

---

## 9. Media & Ambient Noise Upload Endpoints

### 9.1 Request Ambient Noise Upload URL
**`POST /public/agent/{identifier}/ambient-noise/upload-url`** (Alias: `/public/agent/ambient-noise/upload-url`)

**Purpose**: Generates an S3 presigned upload URL to upload custom background audio / ambient sound track files for an agent.

- **Headers**: `X-API-Key: <your_api_key>`
- **Request Body**:
```json
{
  "filename": "office_chatter.wav",
  "mime_type": "audio/wav",
  "file_size": 2048576
}
```
- **Response (`200 OK`)**:
```json
{
  "upload_url": "https://minio.your-domain.com/voice-audio/ambient/...",
  "storage_key": "ambient/office_chatter.wav"
}
```

---

## 10. Public Embed & WebRTC Widget Endpoints

These endpoints do not require an API key and are publicly accessible to power embedded web voice widgets and web chat widgets.

### 10.1 Initialize Embed WebRTC Session
**`POST /public/embed/init`**

**Purpose**: Initiates a WebRTC voice session token for embedded website widgets.

- **Request Body**:
```json
{
  "token": "pub_embed_key_123"
}
```
- **Response (`200 OK`)**: WebRTC session token and server connection details.

---

### 10.2 Get Embed Widget Configuration
**`GET /public/embed/config/{token}`**

**Purpose**: Fetches branding, colors, agent title, and UI options for an embedded widget.

- **Path Parameters**: `token` (string)
- **Response (`200 OK`)**: Widget UI config JSON.

---

### 10.3 Get TURN Credentials for WebRTC
**`GET /public/embed/turn-credentials/{session_token}`**

**Purpose**: Returns ephemeral ICE/TURN relay server credentials to bypass NAT/firewalls during WebRTC calls.

- **Path Parameters**: `session_token` (string)
- **Response (`200 OK`)**: TURN server URIs, username, and credential.

---

### 10.4 Get Embed Web Chat Configuration
**`GET /public/embed/chat/config/{public_key}`**

**Purpose**: Fetches configuration for embedded web chat widgets.

- **Path Parameters**: `public_key` (string)
- **Response (`200 OK`)**: Chat widget configuration.

---

### 10.5 Initialize Embed Web Chat Session
**`POST /public/embed/chat/init`**

**Purpose**: Initializes a new public web chat session token.

- **Request Body**: `{"public_key": "..."}`
- **Response (`200 OK`)**: Session initialization object.

---

### 10.6 Send Embed Web Chat Message
**`POST /public/embed/chat/message`**

**Purpose**: Sends a message from the embed web chat widget.

- **Request Body**: `{"session_token": "...", "message": "Hello"}`
- **Response (`200 OK`)**: AI chat response turn.

---

## 11. Public Artifact Download Endpoints

### 11.1 Download Call Recording or Transcript Artifact
**`GET /public/download/workflow/{token}/{artifact_type}`**

**Purpose**: Serves or downloads public call recordings (audio/wav or audio/mp3) or transcript files using a secure public access token.

- **Path Parameters**:
  - `token` (string): The public access token for the workflow run.
  - `artifact_type` (string): Either `recording` or `transcript`.
- **Response (`200 OK`)**:
  - For `recording`: Binary audio file stream (`audio/wav` or `audio/mpeg`).
  - For `transcript`: Plain text or JSON transcript.

---

## Summary Table of All Endpoints

| Category | Method | Endpoint Path | Auth Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| **Calls** | `POST` | `/public/agent/{trigger_path}` | `X-API-Key` | Initiate production call by trigger path |
| **Calls** | `POST` | `/public/agent/test/{trigger_path}` | `X-API-Key` | Initiate draft test call by trigger path |
| **Calls** | `POST` | `/public/agent/workflow/{workflow_uuid}` | `X-API-Key` | Initiate call by workflow UUID |
| **Calls** | `POST` | `/public/agent/test/workflow/{workflow_uuid}` | `X-API-Key` | Initiate test call by workflow UUID |
| **Calls** | `POST` | `/public/agent/follow-up` | `X-API-Key` | Schedule / retrigger future call |
| **Agents** | `POST` | `/public/agent` | `X-API-Key` | Create new public agent |
| **Agents** | `GET` | `/public/agent` | `X-API-Key` | List all organization agents |
| **Agents** | `GET` | `/public/agent/{identifier}` | `X-API-Key` | Fetch agent details |
| **Agents** | `PUT` | `/public/agent/{identifier}` | `X-API-Key` | Update agent configuration |
| **Agents** | `PUT` | `/public/agent/{identifier}/status` | `X-API-Key` | Update agent active/archived status |
| **Agents** | `DELETE`| `/public/agent/{identifier}` | `X-API-Key` | Delete/archive agent |
| **Agents** | `POST` | `/public/agent/{identifier}/publish` | `X-API-Key` | Publish draft agent version to production |
| **Agents** | `POST` | `/public/agent/{identifier}/create-draft` | `X-API-Key` | Create editable agent draft |
| **Agents** | `GET` | `/public/agent/{identifier}/versions` | `X-API-Key` | Get agent release version history |
| **Agents** | `POST` | `/public/agent/duplicate` | `X-API-Key` | Duplicate an agent workflow |
| **Agents** | `PUT` | `/public/agent/{identifier}/folder` | `X-API-Key` | Assign agent to folder |
| **Agents** | `POST` | `/public/agent/validate` | `X-API-Key` | Validate workflow graph definition |
| **Templates** | `GET` | `/public/agent/templates` | `X-API-Key` | List agent starter templates |
| **Templates** | `POST` | `/public/agent/templates/{template_id}/duplicate` | `X-API-Key` | Create agent from template |
| **Text Chat** | `POST` | `/public/agent/{identifier}/text-chat/sessions` | `X-API-Key` | Start text chat session |
| **Text Chat** | `GET` | `/public/agent/{identifier}/text-chat/sessions/{run_id}` | `X-API-Key` | Get text chat session history |
| **Text Chat** | `POST` | `/public/agent/{identifier}/text-chat/sessions/{run_id}/messages` | `X-API-Key` | Send text chat message |
| **Text Chat** | `POST` | `/public/agent/{identifier}/text-chat/sessions/{run_id}/rewind` | `X-API-Key` | Rewind text chat state |
| **Runs** | `GET` | `/public/agent/{identifier}/runs` | `X-API-Key` | List call runs for an agent |
| **Runs** | `GET` | `/public/agent/runs/{run_id}` | `X-API-Key` | Get details of a call run |
| **Runs** | `GET` | `/public/workflow/{workflow_id}/runs/{run_id}` | `X-API-Key` | Get run details by workflow ID |
| **Usage** | `GET` | `/public/agent/count` | `X-API-Key` | Get organization agent counts |
| **Usage** | `GET` | `/public/agent/summary` | `X-API-Key` | Get organization metrics summary |
| **Usage** | `GET` | `/public/organizations/usage/runs` | `X-API-Key` | Get usage run history |
| **Usage** | `GET` | `/public/organizations/usage/runs/report` | `X-API-Key` | Download usage CSV report |
| **Usage** | `GET` | `/public/organizations/usage/current-period` | `X-API-Key` | Get current billing period usage |
| **Usage** | `GET` | `/public/organizations/usage/daily-breakdown` | `X-API-Key` | Get daily usage breakdown |
| **Reports** | `GET` | `/public/agent/{identifier}/runs/{run_id}/report` | `X-API-Key` | Get run report info |
| **Reports** | `GET` | `/public/agent/{identifier}/report/download` | `X-API-Key` | Download agent CSV report |
| **Reports** | `GET` | `/public/agent/{identifier}/report/download/pdf` | `X-API-Key` | Download agent PDF reports (ZIP) |
| **Media** | `POST` | `/public/agent/{identifier}/ambient-noise/upload-url` | `X-API-Key` | Request ambient noise upload URL |
| **Embed** | `POST` | `/public/embed/init` | None | Initialize embed WebRTC session |
| **Embed** | `GET` | `/public/embed/config/{token}` | None | Get embed widget configuration |
| **Embed** | `GET` | `/public/embed/turn-credentials/{session_token}` | None | Get TURN relay credentials |
| **Embed** | `GET` | `/public/embed/chat/config/{public_key}` | None | Get web chat config |
| **Embed** | `POST` | `/public/embed/chat/init` | None | Initialize web chat session |
| **Embed** | `POST` | `/public/embed/chat/message` | None | Send web chat message |
| **Artifacts** | `GET` | `/public/download/workflow/{token}/{artifact_type}` | None | Download call recording or transcript |
| **Telephony** | `GET` | `/public/telephony-configs` | `X-API-Key` | List telephony configurations |
| **Telephony** | `POST` | `/public/telephony-configs` | `X-API-Key` | Create telephony configuration |
| **Telephony** | `GET` | `/public/telephony-configs/{config_id}` | `X-API-Key` | Get telephony configuration details |
| **Telephony** | `PUT` | `/public/telephony-configs/{config_id}` | `X-API-Key` | Update telephony configuration |
| **Telephony** | `POST` | `/public/telephony-configs/{config_id}/set-default-outbound` | `X-API-Key` | Set default outbound carrier |
| **Telephony** | `DELETE` | `/public/telephony-configs/{config_id}` | `X-API-Key` | Delete telephony configuration |
| **Phone Numbers** | `GET` | `/public/telephony-configs/{config_id}/phone-numbers` | `X-API-Key` | List phone numbers for a configuration |
| **Phone Numbers** | `POST` | `/public/telephony-configs/{config_id}/phone-numbers` | `X-API-Key` | Add phone number to configuration |
| **Phone Numbers** | `GET` | `/public/telephony-configs/{config_id}/phone-numbers/{phone_number_id}` | `X-API-Key` | Get phone number details |
| **Phone Numbers** | `PUT` | `/public/telephony-configs/{config_id}/phone-numbers/{phone_number_id}` | `X-API-Key` | Update phone number configuration |
| **Phone Numbers** | `POST` | `/public/telephony-configs/{config_id}/phone-numbers/{phone_number_id}/set-default-caller` | `X-API-Key` | Set phone number as default caller ID |
| **Phone Numbers** | `DELETE` | `/public/telephony-configs/{config_id}/phone-numbers/{phone_number_id}` | `X-API-Key` | Delete phone number registration |

---

## 12. Telephony Configuration & Phone Number Endpoints

These endpoints allow external systems to programmatically configure SIP trunks/telephony carriers (Twilio, Telnyx, Plivo, Vonage, Cloudonix, Vobiz, ARI) and manage phone numbers.

### 12.1 List Telephony Configurations
**`GET /public/telephony-configs`**

- **Headers**: `X-API-Key: <your_api_key>`
- **Response (`200 OK`)**:
```json
{
  "configurations": [
    {
      "id": 12,
      "name": "Primary Twilio Carrier",
      "provider": "twilio",
      "is_default_outbound": true,
      "phone_number_count": 3,
      "created_at": "2026-09-01T10:00:00Z",
      "updated_at": "2026-09-01T10:00:00Z"
    }
  ]
}
```

### 12.2 Create Telephony Configuration
**`POST /public/telephony-configs`**

- **Headers**: `X-API-Key: <your_api_key>`
- **Request Body**:
```json
{
  "name": "Twilio Main Trunk",
  "is_default_outbound": true,
  "config": {
    "provider": "twilio",
    "account_sid": "ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    "auth_token": "secret_token_here"
  }
}
```
- **Response (`200 OK`)**: Returns `TelephonyConfigurationDetail` with sensitive credential fields masked.

### 12.3 Get Telephony Configuration
**`GET /public/telephony-configs/{config_id}`**

- **Headers**: `X-API-Key: <your_api_key>`
- **Response (`200 OK`)**: Detailed configuration metadata and masked credentials.

### 12.4 Update Telephony Configuration
**`PUT /public/telephony-configs/{config_id}`**

- **Headers**: `X-API-Key: <your_api_key>`
- **Request Body**:
```json
{
  "name": "Updated Carrier Name",
  "config": {
    "provider": "twilio",
    "account_sid": "ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    "auth_token": "updated_secret_token"
  }
}
```

### 12.5 Set Default Outbound Telephony Configuration
**`POST /public/telephony-configs/{config_id}/set-default-outbound`**

- **Headers**: `X-API-Key: <your_api_key>`
- **Response (`200 OK`)**: Updated configuration details.

### 12.6 Delete Telephony Configuration
**`DELETE /public/telephony-configs/{config_id}`**

- **Headers**: `X-API-Key: <your_api_key>`
- **Response (`200 OK`)**: `{"message": "Telephony configuration deleted"}`

### 12.7 List Phone Numbers for Configuration
**`GET /public/telephony-configs/{config_id}/phone-numbers`**

- **Headers**: `X-API-Key: <your_api_key>`
- **Response (`200 OK`)**: List of phone numbers registered under this carrier configuration.

### 12.8 Register Phone Number under Configuration
**`POST /public/telephony-configs/{config_id}/phone-numbers`**

- **Headers**: `X-API-Key: <your_api_key>`
- **Request Body**:
```json
{
  "address": "+15551234567",
  "country_code": "US",
  "label": "Support Line",
  "inbound_workflow_id": 42,
  "is_active": true,
  "is_default_caller_id": true
}
```

### 12.9 Get Phone Number Details
**`GET /public/telephony-configs/{config_id}/phone-numbers/{phone_number_id}`**

- **Headers**: `X-API-Key: <your_api_key>`

### 12.10 Update Phone Number Configuration
**`PUT /public/telephony-configs/{config_id}/phone-numbers/{phone_number_id}`**

- **Headers**: `X-API-Key: <your_api_key>`
- **Request Body**:
```json
{
  "label": "Sales Hotline",
  "inbound_workflow_id": 45,
  "is_active": true
}
```

### 12.11 Set Default Caller ID
**`POST /public/telephony-configs/{config_id}/phone-numbers/{phone_number_id}/set-default-caller`**

- **Headers**: `X-API-Key: <your_api_key>`

### 12.12 Delete Phone Number
**`DELETE /public/telephony-configs/{config_id}/phone-numbers/{phone_number_id}`**

- **Headers**: `X-API-Key: <your_api_key>`
- **Response (`200 OK`)**: `{"message": "Phone number deleted"}`

---

## 13. WhatsApp Channel Public Endpoints

Public endpoints for managing WhatsApp numbers (OpenWA sessions), AI agents, character presets, and message history.

### 13.1 List WhatsApp Numbers
**`GET /public/whatsapp/numbers`**

- **Headers**: `X-API-Key: <your_api_key>`
- **Response (`200 OK`)**:
```json
{
  "numbers": [
    {
      "id": 5,
      "name": "Support WhatsApp",
      "phone_number": "+15550199",
      "status": "connected",
      "openwa_session_name": "wa_org_10_5",
      "assigned_agent_id": 12,
      "created_at": "2026-10-05T00:00:00Z"
    }
  ]
}
```

### 13.2 Create WhatsApp Number Connection
**`POST /public/whatsapp/numbers`**

- **Headers**: `X-API-Key: <your_api_key>`
- **Request Body**:
```json
{
  "name": "Sales WhatsApp"
}
```

### 13.3 Get WhatsApp Number Details
**`GET /public/whatsapp/numbers/{number_id}`**

- **Headers**: `X-API-Key: <your_api_key>`

### 13.4 Get WhatsApp Pairing QR Code
**`GET /public/whatsapp/numbers/{number_id}/qr`**

- **Headers**: `X-API-Key: <your_api_key>`
- **Response (`200 OK`)**:
```json
{
  "status": "qr",
  "qr": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
}
```

### 13.5 Start / Stop Session
- **`POST /public/whatsapp/numbers/{number_id}/start`**
- **`POST /public/whatsapp/numbers/{number_id}/stop`**

### 13.6 Delete WhatsApp Connection
**`DELETE /public/whatsapp/numbers/{number_id}`**

- **Headers**: `X-API-Key: <your_api_key>`
- **Response (`200 OK`)**: `{"message": "WhatsApp number deleted"}`

### 13.7 Attach / Detach Agent to WhatsApp Number
**`PATCH /public/whatsapp/numbers/{number_id}/agent`**

- **Headers**: `X-API-Key: <your_api_key>`
- **Request Body**:
```json
{
  "agent_id": 12
}
```

### 13.8 List Character Presets
**`GET /public/whatsapp/characters`**

- **Headers**: `X-API-Key: <your_api_key>`

### 13.9 List WhatsApp Agents
**`GET /public/whatsapp/agents`**

- **Headers**: `X-API-Key: <your_api_key>`

### 13.10 Create WhatsApp Agent
**`POST /public/whatsapp/agents`**

- **Headers**: `X-API-Key: <your_api_key>`
- **Request Body**:
```json
{
  "name": "Support Assistant",
  "character": "support",
  "system_prompt": "You are a customer support agent.",
  "greeting": "Hello! How can I help you today?"
}
```

### 13.11 Get / Update / Delete WhatsApp Agent
- **`GET /public/whatsapp/agents/{agent_id}`**
- **`PATCH /public/whatsapp/agents/{agent_id}`**
- **`DELETE /public/whatsapp/agents/{agent_id}`**

### 13.12 List WhatsApp Conversations & Message Details
- **`GET /public/whatsapp/conversations`**
- **`GET /public/whatsapp/conversations/{conversation_id}`**


