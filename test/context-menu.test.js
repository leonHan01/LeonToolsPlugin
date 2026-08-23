import assert from "node:assert/strict";
import { test } from "node:test";
import { menuPosition } from "../js/context-menu.js";

test("menuPosition keeps the menu inside the viewport", () => {
  assert.deepEqual(menuPosition(10, 10, 120, 64, 400, 300), { left: 10, top: 10 });
  assert.deepEqual(menuPosition(380, 280, 120, 64, 400, 300), { left: 272, top: 228 });
  assert.deepEqual(menuPosition(-20, -20, 120, 64, 400, 300), { left: 8, top: 8 });
});
