// Run via `node scripts/test-teams-navigation.mts` from ui/ (Node 22/24+ strips TS types).

import assert from "node:assert/strict";

import {
  ADMIN_ITEMS,
  CHANNELS_ITEMS,
  findNavItem,
  isNavItemActive,
  OVERVIEW_ITEM,
  RESOURCE_ITEMS,
  TEAMS_ITEM,
  TEAMS_SUB_ITEMS,
} from "../src/components/layout/sidebar/navigation.ts";

// 1. Standalone Teams Navigation Item
assert.equal(TEAMS_ITEM.title, "Teams");
assert.equal(TEAMS_ITEM.url, "/teams?tab=hierarchy");
assert.ok(TEAMS_ITEM.icon, "Teams must have an icon");

// Teams keeps the three user-facing modules in their existing order.
assert.deepEqual(
  TEAMS_SUB_ITEMS.map((item) => item.title),
  ["Hierarchy", "Teams & Members", "Agent Access"],
);

// 2. Navigation level verification: Leads and Teams are separate items
const leadsIndex = ADMIN_ITEMS.findIndex((item) => item.title === "Leads");
assert.ok(leadsIndex !== -1, "Leads item must exist in ADMIN_ITEMS");
assert.equal(ADMIN_ITEMS[leadsIndex].url, "/admin/leads");

assert.equal(TEAMS_ITEM.title, "Teams");
assert.equal(TEAMS_ITEM.url, "/teams?tab=hierarchy");

// 3. Channels & Resources order preserved exactly
assert.equal(CHANNELS_ITEMS[0].title, "Telephony");
assert.equal(CHANNELS_ITEMS[1].title, "WhatsApp Numbers");
assert.equal(CHANNELS_ITEMS[2].title, "Connect Email");
assert.equal(CHANNELS_ITEMS[3].title, "Campaigns");
assert.equal(RESOURCE_ITEMS[0].title, "Tools");
assert.equal(RESOURCE_ITEMS[1].title, "Knowledge Base");
assert.equal(RESOURCE_ITEMS[2].title, "Recordings");

// 4. Overview is Dashboard/Overview
assert.equal(OVERVIEW_ITEM.url, "/overview");

// 4. Teams route resolution
assert.ok(isNavItemActive(TEAMS_ITEM, "/teams"));
assert.ok(isNavItemActive(TEAMS_ITEM, "/teams/123"));
assert.ok(!isNavItemActive(TEAMS_ITEM, "/admin/leads"));
assert.ok(!isNavItemActive(TEAMS_ITEM, "/voice/agents"));

// 5. findNavItem matches /teams
const foundTeams = findNavItem("/teams");
assert.ok(foundTeams, "findNavItem should locate /teams");
assert.equal(foundTeams.title, "Teams");

console.log("Teams navigation tests passed successfully!");

