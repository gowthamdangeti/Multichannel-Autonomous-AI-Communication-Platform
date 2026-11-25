// Run via `npm run test:search-filter` from ui/ (Node 24+ strips TS types natively).

import assert from "node:assert/strict";

import {
  ALL_FILTER,
  filterBySearch,
  matchesFilter,
  toActiveValue,
  toFilterLabel,
  toFilterOptions,
} from "../src/lib/searchFilter.ts";

const items = [{ name: "Support Agent" }, { name: "sales" }, { name: null }];
const byName = (item: { name: string | null }) => item.name;

assert.equal(filterBySearch(items, "", byName).length, 3);
assert.equal(filterBySearch(items, "   ", byName).length, 3);
assert.deepEqual(filterBySearch(items, "SUPP", byName), [items[0]]);
assert.deepEqual(filterBySearch(items, "  sales ", byName), [items[1]]);
assert.deepEqual(filterBySearch(items, "missing", byName), []);

assert.equal(toFilterLabel("http_api"), "Http api");
assert.equal(toFilterLabel("in-progress"), "In progress");

// Options are unique, sorted by label, and skip missing values.
const options = toFilterOptions(
  [{ state: "running" }, { state: "failed" }, { state: "running" }, { state: null }],
  (row) => row.state,
);
assert.deepEqual(options, [
  { value: "failed", label: "Failed" },
  { value: "running", label: "Running" },
]);
assert.deepEqual(toFilterOptions([{ s: "a" }], (row) => row.s, () => "Custom"), [{ value: "a", label: "Custom" }]);

assert.equal(matchesFilter("running", ALL_FILTER), true);
assert.equal(matchesFilter(null, ALL_FILTER), true);
assert.equal(matchesFilter("running", "running"), true);
assert.equal(matchesFilter("failed", "running"), false);
assert.equal(matchesFilter(null, "running"), false);

assert.equal(toActiveValue(true), "active");
assert.equal(toActiveValue(false), "inactive");

console.log("search filter tests passed");
