// Run via `npm run test:overview-data` from ui/ (Node 24+ strips TS types natively).

import assert from "node:assert/strict";

import {
  type OrgStats,
  toBreakdowns,
  toCallShare,
  toHighlights,
  toTrendRows,
} from "../src/components/overview/overviewData.ts";

const stats: OrgStats = {
  current_calls: 20,
  prev_calls: 10,
  total_minutes: 90,
  avg_duration_seconds: 75,
  daily: [
    { date: "2026-10-01", calls: 9, duration: 600 },
    { date: "2026-10-31", calls: 4, duration: 90 },
    { date: "2026-11-05", calls: 2 },
    { date: "2026-11-06", calls: 1, duration: 60 },
  ],
  top_workflows: [{ name: "Support", calls: 15, avg_duration: 80 }],
  mode_breakdown: [{ mode: "webrtc", count: 3 }, { mode: "sip", count: 1 }],
  state_breakdown: [{ state: "completed", count: 3 }, { state: "failed", count: 1 }],
  call_type_breakdown: [{ type: "inbound", count: 1 }, { type: "outbound", count: 3 }],
  hourly: [{ hour: 7, calls: 2 }, { hour: 14, calls: 6 }],
  weekday: [{ day: "Mon", calls: 2 }, { day: "Fri", calls: 5 }],
};

// A range counts calendar days, including days the API left out.
// Duration is stored in seconds and shown in minutes; a missing value is zero.
const rows = toTrendRows(stats.daily);
assert.equal(rows.length, stats.daily.length);
assert.equal(rows[1].minutes, 2);
assert.equal(rows[2].minutes, 0);

const breakdowns = toBreakdowns(stats);
assert.deepEqual(breakdowns.modes.map((m) => m.name), ["WebRTC", "Sip"]);
assert.deepEqual(breakdowns.states.map((s) => s.name), ["Completed", "Failed"]);

const highlights = Object.fromEntries(toHighlights(stats).map((h) => [h.label, h.value]));
assert.equal(highlights["Busiest hour"], "14:00");
assert.equal(highlights["Peak day"], "Fri");
assert.equal(highlights["Top agent"], "Support");
assert.equal(highlights["Completion rate"], "75%");
assert.equal(highlights["Inbound share"], "25%");

// No data shows a dash, never 0% or NaN.
for (const highlight of toHighlights(null)) assert.equal(highlight.value, "—");
assert.deepEqual(toBreakdowns(null).modes, []);

assert.equal(toCallShare(15, 20), "75%");
assert.equal(toCallShare(0, 0), "—");

console.log("overview data tests passed");
