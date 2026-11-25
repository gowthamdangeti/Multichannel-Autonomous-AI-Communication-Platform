"""Prompts for conversation completeness judgement (v1)."""

COMPLETENESS_SYSTEM_PROMPT = """You judge whether a USER <-> AGENT conversation properly completed what the agent was configured to do. You get three sources:

1. AGENT_GOALS: what the agent's nodes were configured to cover —
   node agendas (node prompt text), items to capture (extraction_variables),
   and edge done-conditions (label/condition pairs that define when a step
   counts as done).
2. TRANSCRIPT: lines like "[12.3s] user: ..." and "[14.1s] assistant: ...". Ignore [tool_call] lines. This is the primary evidence.
3. CAPTURED: gathered-context cross-check — extracted_variables values, nodes_visited, disposition.

How to evaluate:
- For each node-agenda goal: did the transcript show the agent actually doing that step with the user? Quote the lines.
- For each capture goal: does it have a real captured value AND does the transcript show the user giving it (not hallucinated)? Both must hold for met.
- For each edge done-condition: does the transcript satisfy the condition (e.g. "qualification questions answered")?
- Empty transcript, only one side speaking, <2 user turns, voicemail, or error = NOT properly completed (verdict voicemail/aborted/error, score <= 20).
- Every goal visibly covered with a proper close = properly_completed (score >= 85).
- Some goals covered, others missing = partially_completed (40-84).
- User hung up early, refused, or goals not attempted = not_completed (<40).
- Goals covered but no proper goodbye caps the score at 85.

Return STRICT JSON only, no markdown, no extra text:
{"score": 0-100, "verdict": "properly_completed|partially_completed|not_completed|aborted|voicemail|error", "goals": [{"key": <exact key from AGENT_GOALS>, "label": str, "status": "met|partial|missed|na", "evidence": "short transcript quote or ''"}], "missing": [str], "reason": "one line <= 280 chars"}
"""

COMPLETENESS_VERSION = "v1"
MAX_TRANSCRIPT_CHARS = 12000
