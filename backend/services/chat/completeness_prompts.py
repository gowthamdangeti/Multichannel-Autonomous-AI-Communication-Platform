"""Prompt and limits for the chat conversation completeness judge (chat-v1).

Same verdicts, score bands and goal statuses as the voice judge
(``api/services/completeness/prompts.py``) so a chat evaluation reads and
aggregates exactly like a voice one. The goals come from the chat agent's own
prompt instead of a workflow graph.
"""

CHAT_COMPLETENESS_VERSION = "chat-v1"

# The agent prompt and the transcript are cut to these before being sent.
MAX_AGENT_PROMPT_CHARS = 6000
MAX_TRANSCRIPT_CHARS = 12000

CHAT_COMPLETENESS_SYSTEM_PROMPT = """You judge whether a website chat between a VISITOR and an AI agent properly completed what the agent was configured to do. You get four sources:

1. AGENT_PROMPT: the instructions the agent runs on. Read it as the agent's job description and derive its GOALS from it: what it must find out or collect from the visitor, which questions it must answer, which steps it must walk through, and what a proper close looks like. Use at most 8 goals, each a short label (e.g. "Capture visitor's email").
2. GREETING: the agent's opening message, if any.
3. TRANSCRIPT: lines like "[1] visitor: ..." and "[2] agent: ...". This is the primary evidence.
4. SESSION: how the visitor's session ended - "completed" (the visitor pressed Exit or began a new chat), "disconnected" (the visitor closed or refreshed the page mid-chat), or "open" (no end reported).

How to evaluate:
- For each goal: did the transcript show the agent actually doing that step with the visitor? Quote the line as evidence. A goal the visitor never gave the information for is missed, even if the agent asked.
- Judge only what the transcript shows. Never credit a goal because the prompt says the agent can do it.
- Fewer than 2 visitor messages, or the agent never replied = NOT properly completed (verdict aborted or error, score <= 20).
- Every goal visibly covered with a proper close = properly_completed (score >= 85).
- Some goals covered, others missing = partially_completed (40-84).
- Visitor left early, refused, or goals not attempted = not_completed (< 40).
- SESSION "disconnected" while goals remain open means the visitor dropped off: do not score it properly_completed.
- Goals covered but no proper goodbye caps the score at 85.

Return STRICT JSON only, no markdown, no extra text:
{"score": 0-100, "verdict": "properly_completed|partially_completed|not_completed|aborted|error", "goals": [{"key": "short_snake_case", "label": str, "status": "met|partial|missed|na", "evidence": "short transcript quote or ''"}], "missing": [str], "reason": "one line <= 280 chars"}
"""
