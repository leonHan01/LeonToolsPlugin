import assert from "node:assert/strict";
import { test } from "node:test";
import { TOOL_ICON_PATHS, TOOL_ICONS } from "../js/tool-icons.js";
import { hasIcon } from "../js/dom.js";

test("tool icon catalog ids are unique and drawable", () => {
  const ids = TOOL_ICONS.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes("favicon"));
  assert.ok(ids.includes("sparkles"));
  for (const item of TOOL_ICONS) {
    if (item.id === "favicon") continue;
    assert.equal(hasIcon(item.id), true, item.id);
    assert.ok(TOOL_ICON_PATHS[item.id] || hasIcon(item.id), item.id);
  }
});
