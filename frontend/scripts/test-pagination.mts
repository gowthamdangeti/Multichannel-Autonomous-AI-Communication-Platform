// Run via `npm run test:pagination` from ui/ (Node 24+ strips TS types natively).

import assert from "node:assert/strict";

import { clampPage, getPageCount, getPageItems, getPageNumbers } from "../src/lib/pagination.ts";

assert.equal(getPageCount(0, 8), 0);
assert.equal(getPageCount(8, 8), 1);
assert.equal(getPageCount(9, 8), 2);

// A list that shrinks under the current page falls back to its last page.
assert.equal(clampPage(5, 2), 2);
assert.equal(clampPage(5, 0), 1);
assert.equal(clampPage(0, 3), 1);
assert.equal(clampPage(2, 3), 2);

const items = Array.from({ length: 10 }, (_, index) => index + 1);
assert.deepEqual(getPageItems(items, 1, 8), [1, 2, 3, 4, 5, 6, 7, 8]);
assert.deepEqual(getPageItems(items, 2, 8), [9, 10]);

assert.deepEqual(getPageNumbers(2, 3), [1, 2, 3]);
assert.deepEqual(getPageNumbers(1, 7), [1, 2, 3, 4, 5, 6, 7]);
assert.deepEqual(getPageNumbers(1, 10), [1, 2, "ellipsis", 10]);
assert.deepEqual(getPageNumbers(5, 10), [1, "ellipsis", 4, 5, 6, "ellipsis", 10]);
assert.deepEqual(getPageNumbers(10, 10), [1, "ellipsis", 9, 10]);

console.log("pagination tests passed");
