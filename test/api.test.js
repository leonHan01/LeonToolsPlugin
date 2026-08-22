import assert from "node:assert/strict";
import { test } from "node:test";
import { apiRequest, clip, isRemoteId, parseTime } from "../js/api.js";
import { installChrome, browserUi } from "./helpers.js";

test("isRemoteId accepts numeric backend ids only", () => {
  assert.equal(isRemoteId("12"), true);
  assert.equal(isRemoteId(3), true);
  assert.equal(isRemoteId("3a"), false);
  assert.equal(isRemoteId("uuid-like"), false);
  assert.equal(isRemoteId(""), false);
});

test("clip trims and truncates", () => {
  assert.equal(clip("  hello  ", 10), "hello");
  assert.equal(clip("abcdefghij", 4), "abcd");
  assert.equal(clip(null, 4), "");
});

test("parseTime handles number, array, string and fallback", () => {
  assert.equal(parseTime(1700000000000), 1700000000000);
  const fromArray = parseTime([2026, 8, 22, 10, 0, 0]);
  assert.equal(new Date(fromArray).getFullYear(), 2026);
  assert.equal(new Date(fromArray).getMonth(), 7);
  const fromIso = parseTime("2026-08-22T10:00:00");
  assert.equal(Number.isNaN(fromIso), false);
  const fallback = parseTime("not-a-date");
  assert.equal(typeof fallback, "number");
});

test("apiRequest unwraps wrapped data", async () => {
  installChrome({ local: { "myWorkflow.ui": browserUi() } });
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    json: async () => ({ success: true, data: { id: 1 } }),
  });
  try {
    const data = await apiRequest("/api/notes");
    assert.equal(data.id, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("apiRequest throws backend message", async () => {
  installChrome({ local: { "myWorkflow.ui": browserUi() } });
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 400,
    headers: { get: () => "application/json" },
    json: async () => ({ success: false, message: "便签内容不能为空" }),
  });
  try {
    await assert.rejects(() => apiRequest("/api/notes", { method: "POST", body: {} }), /便签内容不能为空/);
  } finally {
    globalThis.fetch = original;
  }
});

test("apiRequest throws when success is false", async () => {
  installChrome({ local: { "myWorkflow.ui": browserUi() } });
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    json: async () => ({ success: false, message: "请求失败" }),
  });
  try {
    await assert.rejects(() => apiRequest("/api/notes"), /请求失败/);
  } finally {
    globalThis.fetch = original;
  }
});
