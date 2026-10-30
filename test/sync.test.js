import assert from "node:assert/strict";
import { test } from "node:test";
import { syncNow } from "../js/sync.js";
import { STORAGE_KEY, TODOS_KEY, UI_KEY } from "../js/settings.js";
import { pushLocalTodos } from "../js/todos.js";
import { installChrome } from "./helpers.js";

function response(data, ok = true) {
  return { ok, status: ok ? 200 : 500, headers: { get: () => "application/json" }, json: async () => ok ? { data } : { message: "模拟写入失败" } };
}

test("partial legacy collection migration keeps remaining items for retry", async () => {
  const original = globalThis.fetch;
  const env = installChrome({ local: {
    [UI_KEY]: { storageMode: "browser" },
    [STORAGE_KEY]: { collections: [{ id: "local-c", name: "旧集合", dirty: true, groups: [{ id: "local-g", name: "默认分组", dirty: true, items: [{ id: "local-i", title: "页面", url: "https://example.com", dirty: true }] }] }] },
  } });
  let attempt = 0;
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname;
    if (path === "/api/web-collections" && !options.method) return response([]);
    if (path === "/api/web-collections" && options.method === "POST") return response({ id: 10, name: "旧集合", groups: [{ id: 20, name: "默认分组" }] });
    if (path === "/api/web-collections/10/items" && options.method === "POST") {
      attempt += 1;
      return attempt === 1 ? response(null, false) : response({ id: 30 });
    }
    if (path === "/api/web-collections/full") return response([{ id: 10, name: "旧集合", groups: [{ id: 20, name: "默认分组", items: [{ id: 30, name: "页面", url: "https://example.com" }] }] }]);
    return response({});
  };
  try {
    const first = await syncNow();
    assert.equal(first.ok, false);
    let saved = env.local.get(STORAGE_KEY).collections[0];
    assert.equal(saved.id, "10");
    assert.equal(saved.groups[0].id, "20");
    assert.equal(saved.groups[0].items[0].id, "local-i");
    const second = await syncNow();
    assert.equal(second.ok, true);
    saved = env.local.get(STORAGE_KEY).collections[0];
    assert.equal(saved.groups[0].items[0].id, "30");
    assert.equal(attempt, 2);
  } finally { globalThis.fetch = original; }
});

test("a completed legacy todo keeps its new ID when the follow-up update fails", async () => {
  const original = globalThis.fetch;
  const env = installChrome({ local: {
    [TODOS_KEY]: { todos: [{ id: "local-todo", content: "旧待办", done: true, dirty: true }] },
  } });
  let creates = 0;
  let updates = 0;
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname;
    if (path === "/api/web-collections") return response([]);
    if (path === "/api/todos" && options.method === "POST") { creates += 1; return response({ id: 42 }); }
    if (path === "/api/todos/42" && options.method === "PUT") { updates += 1; return response({}, updates > 1); }
    throw new Error(`unexpected request ${path}`);
  };
  try {
    assert.equal(await pushLocalTodos(), false);
    assert.equal(env.local.get(TODOS_KEY).todos[0].id, "42");
    assert.equal(env.local.get(TODOS_KEY).todos[0].dirty, true);
    assert.equal(await pushLocalTodos(), true);
    assert.equal(env.local.get(TODOS_KEY).todos[0].dirty, false);
    assert.equal(creates, 1);
    assert.equal(updates, 2);
  } finally { globalThis.fetch = original; }
});
