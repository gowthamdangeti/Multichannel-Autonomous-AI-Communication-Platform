"""Generate a new workflow from a natural-language description.

Replaces the removed MPS-hosted ("services.convozent.com") workflow
generator. Uses the organization's own configured LLM (BYOK) via the same
OpenAI-compatible resolver the chat/WhatsApp reply paths use, prompting it
to emit `@convozent/sdk` TypeScript — the same authoring surface the MCP
`create_workflow` tool accepts — then runs it through the same AST parser
and validation pipeline (`ts_bridge.parse_code`, `ReactFlowDTO`,
`WorkflowGraph`). One self-correction retry on validation failure, feeding
the error back to the model, mirrors the MCP tool's own guidance for
iterating on a failed save.
"""

from __future__ import annotations

from loguru import logger
from openai import AsyncOpenAI, BadRequestError  # noqa: F401 - re-exported for tests
from pydantic import ValidationError as PydanticValidationError

from api.mcp_server.ts_bridge import TsBridgeError, parse_code
from api.services.agents_llm import openai_params, resolve_temperature
from api.services.configuration.ai_model_configuration import (
    WORKFLOW_PLATFORM_MODEL_CONFIGURATION_ID_KEY,
    get_effective_ai_model_configuration_for_workflow,
)
from api.services.workflow.dto import ReactFlowDTO
from api.services.workflow.layout import reconcile_positions
from api.services.workflow.workflow_graph import (
    WorkflowGraph,
    extract_template_variables,
)
from api.services.gen_ai.temperature import create_chat_completion

_MAX_ATTEMPTS = 3

_SYSTEM_PROMPT = """\
You author Convozent voice-AI workflows by emitting TypeScript that uses the `@convozent/sdk` package.

## Allowed source shape

Only three top-level statement forms:

    import ... from "...";                      // any import
    const <var> = <initializer>;                // bindings
    wf.edge(<src>, <tgt>, { label, condition }); // bare edge calls

`<initializer>` is one of:
    new Workflow({ name: "..." })
    wf.addTyped(<factory>({ ...fields }))

No functions, arrow fns, loops, conditionals, ternaries, spreads, destructuring, template interpolation, `export`, or `.map`/`.forEach`. Object/array literals (including arrays of objects, e.g. `extraction_variables`) are fine. A single `new Workflow(...)` per file; `name` becomes the workflow's display name.

## Node types (import from "/sdk/typed")

- `globalNode({ name, prompt })` — **required, exactly one, every single time — never skip this node.** Holds persona, tone, and shared rules (e.g. "You are Sarah from Acme. Speak in short, natural sentences. If the caller goes off-topic, gently steer back.") that get appended to every other node's prompt automatically. It takes **no edges** — never reference it in `wf.edge(...)`.
- `startCall({ name, prompt, greeting_type?, greeting?, allow_interrupt?, extraction_enabled?, extraction_prompt?, extraction_variables? })` — exactly one required, the entry point. `greeting` (text, optional) is spoken via TTS before `prompt` takes over; set `greeting_type: "text"` when using it.
- `agentNode({ name, prompt, allow_interrupt?, extraction_enabled?, extraction_prompt?, extraction_variables? })` — exactly one required intermediate turn containing the workflow's main agenda.
- `endCall({ name, prompt, extraction_enabled?, extraction_prompt?, extraction_variables? })` — exactly one required terminal node that closes the conversation.

`prompt` on every node is the agent's system instructions for that turn — write it as direct second-person guidance to the agent (e.g. "Ask the caller for their preferred appointment time."), not a description of what the node does. `name` is a short human label ("Greeting", "Qualify Budget", "Wrap Up"). Don't repeat the global node's persona/tone content in other nodes' prompts — each node's prompt should only cover what's specific to that turn.

### `allow_interrupt` (boolean, default false)

Set `true` on any node where the caller should be able to speak over the agent mid-utterance — this is the natural default for conversational back-and-forth, so set it on **most** `startCall`/`agentNode` turns. Leave it `false` (or omit) only for short, essential lines that shouldn't be cut off, like reading back a confirmation number.

### Variable extraction (`extraction_enabled`, `extraction_prompt`, `extraction_variables`)

Enable extraction on any node where the conversation surfaces a fact worth capturing for downstream use (CRM, call summary, routing). Not every node needs it — only where new information is actually gathered in that turn.

    extraction_enabled: true,
    extraction_prompt: "Extract budget amount and rough timeline.",
    extraction_variables: [
        { name: "budget_usd", type: "number", prompt: "Stated budget in USD" },
        { name: "timeline", type: "string", prompt: "When they want to start" },
    ],

`extraction_variables` entries: `name` (snake_case), `type` (`"string"` | `"number"` | `"boolean"`), `prompt` (short hint of what to look for).

## Edges

    wf.edge(source, target, { label: "...", condition: "..." });

`source`/`target` are the bare variable identifiers from `wf.addTyped(...)`, not strings, and never the global node. `label` is a short tag (<=4 words). `condition` is a full natural-language predicate the runtime evaluates against the live conversation (e.g. "caller confirmed interest in a demo"), not a single word. Both required, non-empty. Place all edges after all node bindings. Every non-start, non-global node needs at least one incoming edge; every non-end, non-global node needs at least one outgoing edge — the conversational nodes must form one fully connected graph (start -> ... -> end) with no dead ends and no cycles.

## Example

    import { Workflow } from "/sdk";
    import { startCall, agentNode, endCall, globalNode } from "/sdk/typed";

    const wf = new Workflow({ name: "Lead Qualification" });
    const persona = wf.addTyped(globalNode({
        name: "Persona",
        prompt: "You are Sarah, a friendly representative from Acme Realty. Speak in short, natural sentences and stay warm throughout the call.",
    }));
    const greet = wf.addTyped(startCall({
        name: "Greeting",
        prompt: "Greet the caller warmly, introduce yourself, and ask what brought them in today.",
        greeting_type: "text",
        greeting: "Hi, thanks for calling! How can I help you today?",
        allow_interrupt: true,
    }));
    const qualify = wf.addTyped(agentNode({
        name: "Qualify",
        prompt: "Ask about their budget and timeline to determine if they're a good fit.",
        allow_interrupt: true,
        extraction_enabled: true,
        extraction_prompt: "Extract budget amount and rough timeline.",
        extraction_variables: [
            { name: "budget_usd", type: "number", prompt: "Stated budget in USD" },
            { name: "timeline", type: "string", prompt: "When they want to start" },
        ],
    }));
    const done = wf.addTyped(endCall({
        name: "Wrap Up",
        prompt: "Thank the caller, summarize next steps, and end the call politely.",
    }));
    wf.edge(greet, qualify, { label: "engaged", condition: "caller explained what they need" });
    wf.edge(qualify, done, { label: "done", condition: "qualification questions answered" });

## Task

Given a call type, use case, and activity description, generate exactly four nodes total: one edge-less global node plus exactly three conversational nodes — one startCall, one agentNode for the Main Agenda, and one endCall. The conversational graph must contain exactly three edges: Start Call -> Main Agenda when the caller is available and willing to continue; Start Call -> End Call for an early exit such as refusal, wrong person, do-not-call request, or unavailability; and Main Agenda -> End Call when the agenda is complete or no productive action remains. Tailor all conditions to the use case, make them mutually understandable full natural-language predicates, and keep labels to four words or fewer. The End Call prompt must close appropriately for either an early exit or a completed agenda without falsely assuming success. Never add another node or edge. Cover the complete use case inside the Main Agenda prompt instead of splitting it into extra nodes. Output ONLY the TypeScript source — no explanation, no markdown code fences.
"""


class WorkflowGenerationError(Exception):
    """The workflow could not be generated."""


def _extract_code(raw: str) -> str:
    text = (raw or "").strip()
    if text.startswith("```"):
        lines = text.splitlines()
        lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines)
    return text.strip()


def find_missing_global_template_variables(
    payload: dict, required_variables: set[str]
) -> list[str]:
    """Return required placeholders absent from the sole Global Node prompt."""
    global_nodes = [
        node for node in payload.get("nodes", []) if node.get("type") == "globalNode"
    ]
    if len(global_nodes) != 1:
        return sorted(required_variables)

    global_prompt = (global_nodes[0].get("data") or {}).get("prompt") or ""
    generated_variables = extract_template_variables(global_prompt)
    return sorted(required_variables - generated_variables)


def validate_builder_shape(payload: dict) -> None:
    """Require Global + a strict Start -> Main Agenda -> End call chain."""
    nodes = payload.get("nodes") or []
    expected_counts = {
        "globalNode": 1,
        "startCall": 1,
        "agentNode": 1,
        "endCall": 1,
    }
    actual_counts = {
        node_type: sum(1 for node in nodes if node.get("type") == node_type)
        for node_type in expected_counts
    }
    unsupported_types = sorted(
        {
            str(node.get("type"))
            for node in nodes
            if node.get("type") not in expected_counts
        }
    )
    if actual_counts != expected_counts or unsupported_types or len(nodes) != 4:
        details = ", ".join(
            f"{node_type}={actual_counts[node_type]}"
            for node_type in expected_counts
        )
        if unsupported_types:
            details += f"; unsupported={', '.join(unsupported_types)}"
        raise ValueError(
            "Agent Builder must generate exactly one Global Node, one Start Call, "
            f"one Main Agenda Agent Node, and one End Call ({details})."
        )

    node_ids = {
        node["type"]: node.get("id")
        for node in nodes
    }
    expected_edges = {
        (node_ids["startCall"], node_ids["agentNode"]),
        (node_ids["startCall"], node_ids["endCall"]),
        (node_ids["agentNode"], node_ids["endCall"]),
    }
    edges = payload.get("edges") or []
    actual_edges = {(edge.get("source"), edge.get("target")) for edge in edges}
    if len(edges) != 3 or actual_edges != expected_edges:
        raise ValueError(
            "Agent Builder edges must be exactly Start Call -> Main Agenda, "
            "Start Call -> End Call, and Main Agenda -> End Call, with no "
            "additional, reverse, or Global Node edges."
        )


def _validate_payload(
    payload: dict, required_global_variables: set[str] | None = None
) -> None:
    """Defense-in-depth: the same checks `create_workflow` (MCP) runs after
    a successful parse, since the TS parser validates spec shape but not
    full DTO/graph invariants. Also enforces the two structural rules the
    prompt asks for but the model doesn't always follow — a single global
    node, and a bounded node count — so violations retry instead of
    shipping a workflow missing persona config or bloated with nodes."""
    dto = ReactFlowDTO.model_validate(payload)
    WorkflowGraph(dto)

    nodes = payload.get("nodes") or []
    global_count = sum(1 for n in nodes if n.get("type") == "globalNode")
    if global_count == 0:
        raise ValueError(
            "Missing the required global node. Add exactly one "
            "`globalNode({ name, prompt })` with persona/tone/shared rules "
            "and no edges."
        )
    if global_count > 1:
        raise ValueError(
            f"Found {global_count} global nodes; there must be exactly one."
        )

    required = required_global_variables or set()
    if required:
        missing_variables = find_missing_global_template_variables(payload, required)
        if missing_variables:
            formatted = ", ".join(f"{{{{{name}}}}}" for name in missing_variables)
            raise ValueError(
                "The generated Global Node prompt is missing required template "
                f"variables: {formatted}. Include each placeholder exactly as written."
            )

    validate_builder_shape(payload)


def _offset_global_node(payload: dict) -> dict:
    """`reconcile_positions` places every edge-less node at (0, 0) since it
    has no incoming neighbor to sit next to. The global node is always
    edge-less, and the start node usually has no incoming edge either
    (it's the entry point) — left alone, both land on the same spot.
    Nudge the global node above/left of the origin so it renders as its
    own floating card instead of stacking on the start node. Offset sized
    like `layoutNodes.ts`'s SECTION_HORIZONTAL_GAP (500) plus the card's
    own width (350) so it clears the start node with room to spare."""
    for node in payload.get("nodes") or []:
        if node.get("type") == "globalNode":
            pos = node.get("position") or {}
            if not pos.get("x") and not pos.get("y"):
                node["position"] = {"x": -850.0, "y": -160.0}
    return payload


_DEFAULT_TEMPERATURE = 0.4


async def _create_completion(
    client: AsyncOpenAI,
    *,
    model: str,
    messages: list[dict],
    temperature: float,
):
    """Chat completion at `temperature`, falling back to the model's default.

    Some models (e.g. reasoning models behind an OpenAI-compatible proxy) only
    accept their default temperature and reject any other value with a 400 on
    param `temperature`. For those, retry once without it instead of failing.
    """
    return await create_chat_completion(
        client, model=model, messages=messages, temperature=temperature
    )


async def generate_workflow_from_description(
    *,
    call_type: str,
    use_case: str,
    activity_description: str,
    organization_id: int | None,
    user_id: int | None,
    platform_model_configuration_id: int | None = None,
) -> tuple[str, dict]:
    """Return `(name, workflow_definition)` for a freshly generated workflow.

    The LLM (provider, model, base URL and API key) is the one from the model
    configuration preset `platform_model_configuration_id` — the same preset
    the new agent will run on. Without one (or if it is inactive/missing) the
    usual fallback applies: default preset, then the org/platform config.

    Raises `WorkflowGenerationError` if no LLM is configured, or the
    model's output never validates after one retry.
    """
    effective = await get_effective_ai_model_configuration_for_workflow(
        user_id=user_id,
        organization_id=organization_id,
        workflow_configurations=(
            {WORKFLOW_PLATFORM_MODEL_CONFIGURATION_ID_KEY: platform_model_configuration_id}
            if platform_model_configuration_id is not None
            else {}
        ),
    )
    llm = effective.llm
    if llm is None:
        raise WorkflowGenerationError(
            "No LLM is configured for this organization. Set one in "
            "Settings > AI Model Configuration, then try again."
        )

    base_url, model, api_key = openai_params(llm)
    if not api_key:
        raise WorkflowGenerationError(
            "The configured LLM is missing an API key. Check Settings > "
            "AI Model Configuration."
        )

    client = (
        AsyncOpenAI(api_key=api_key, base_url=base_url)
        if base_url
        else AsyncOpenAI(api_key=api_key)
    )

    fallback_name = f"{use_case} - {call_type}"
    required_global_variables = extract_template_variables(activity_description)
    required_variables_instruction = ""
    if required_global_variables:
        placeholders = "\n".join(
            f"- {{{{{name}}}}}" for name in sorted(required_global_variables)
        )
        required_variables_instruction = (
            "\n\nRequired Global Node template variables:\n"
            f"{placeholders}\n"
            "Generate a polished Global Node prompt based on the description. "
            "Include every placeholder above exactly as written in globalNode.prompt. "
            "Do not rename or omit any placeholder, and do not satisfy this rule by "
            "placing it only in another node. Do not copy the raw description verbatim."
        )

    messages: list[dict] = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"Call type: {call_type}\n"
                f"Use case: {use_case}\n"
                f"What the agent should do: {activity_description}"
                f"{required_variables_instruction}"
            ),
        },
    ]

    last_error = "the model returned no usable code"
    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            resp = await _create_completion(
                client,
                model=model,
                messages=messages,
                temperature=resolve_temperature(llm, default=_DEFAULT_TEMPERATURE),
            )
        except Exception as e:
            raise WorkflowGenerationError(f"LLM call failed: {e}") from e

        raw = resp.choices[0].message.content or ""
        code = _extract_code(raw)
        if not code:
            last_error = "the model returned no code"
            messages.append({"role": "assistant", "content": raw})
            messages.append(
                {
                    "role": "user",
                    "content": "You returned no code. Emit the full TypeScript source now.",
                }
            )
            continue

        try:
            parsed = await parse_code(code)
        except TsBridgeError as e:
            raise WorkflowGenerationError(
                f"Internal error validating the generated workflow: {e}"
            ) from e

        if parsed.get("ok"):
            payload = _offset_global_node(reconcile_positions(parsed["workflow"], None))
            try:
                _validate_payload(payload, required_global_variables)
            except (PydanticValidationError, ValueError) as e:
                last_error = str(e)
                logger.warning(
                    f"Workflow generation attempt {attempt} failed post-parse "
                    f"validation: {last_error}"
                )
                messages.append({"role": "assistant", "content": code})
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            f"That code failed validation: {last_error}\n"
                            "Fix the issue and emit the full corrected TypeScript "
                            "source. Output only the code, no explanation, no "
                            "markdown fences."
                        ),
                    }
                )
                continue

            name = (parsed.get("workflowName") or "").strip() or fallback_name
            return name, payload

        errs = parsed.get("errors") or []
        last_error = "; ".join(e.get("message", "") for e in errs) or "unknown validation error"
        logger.warning(
            f"Workflow generation attempt {attempt} failed validation: {last_error}"
        )
        messages.append({"role": "assistant", "content": code})
        messages.append(
            {
                "role": "user",
                "content": (
                    f"That code failed validation: {last_error}\n"
                    "Fix the issue and emit the full corrected TypeScript source. "
                    "Output only the code, no explanation, no markdown fences."
                ),
            }
        )

    raise WorkflowGenerationError(
        f"Could not generate a valid workflow after retrying: {last_error}"
    )
