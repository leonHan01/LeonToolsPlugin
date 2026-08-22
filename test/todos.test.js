import assert from "node:assert/strict";
import { test } from "node:test";
import { createTodo, deleteTodo, updateTodo } from "../js/todos.js";
import { TODOS_KEY } from "../js/settings.js";
import { installOfflineExtension } from "./helpers.js";

test("createTodo rejects blank content", async () => {
  await assert.rejects(() => createTodo("  "), /待办内容不能为空/);
});

test("create update complete and delete todo locally", async () => {
  const env = installOfflineExtension();
  try {
    const item = await createTodo("写测试");
    assert.equal(item.done, false);
    const updated = await updateTodo(item.id, { content: "补覆盖率", done: true });
    assert.equal(updated.content, "补覆盖率");
    assert.equal(updated.done, true);
    await deleteTodo(item.id);
    assert.deepEqual(env.local.get(TODOS_KEY).todos, []);
  } finally {
    env.restoreFetch();
  }
});

test("updateTodo rejects missing id", async () => {
  installOfflineExtension();
  await assert.rejects(() => updateTodo("missing", { content: "x" }), /待办不存在/);
});
