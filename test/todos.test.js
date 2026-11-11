import assert from "node:assert/strict";
import { test } from "node:test";
import { createTodo, deleteTodo, groupTodosByCreatedDate, splitTodoText, updateTodo } from "../js/todos.js";
import { TODOS_KEY } from "../js/settings.js";
import { installBackendExtension, installOfflineExtension } from "./helpers.js";

test("splitTodoText turns urls into link parts and keeps surrounding text", () => {
  assert.deepEqual(splitTodoText("整理个人项目 https://my.feishu.cn/docx/abc"), [
    { text: "整理个人项目 " },
    { url: "https://my.feishu.cn/docx/abc" },
  ]);
  assert.deepEqual(splitTodoText("https://a.example/x). 完"), [
    { url: "https://a.example/x" },
    { text: "). 完" },
  ]);
  assert.deepEqual(splitTodoText("没有链接"), [{ text: "没有链接" }]);
});

test("groupTodosByCreatedDate groups by local creation day", () => {
  const now = new Date(2026, 10, 11, 15).getTime();
  const grouped = groupTodosByCreatedDate(
    [
      { id: "today-open", done: false, sortOrder: 1, createdAt: new Date(2026, 10, 11, 9).getTime() },
      { id: "older", done: false, sortOrder: 0, createdAt: new Date(2026, 10, 8, 9).getTime() },
      { id: "today-done", done: true, sortOrder: 0, createdAt: new Date(2026, 10, 11, 8).getTime() },
      { id: "month-edge", done: false, sortOrder: 0, createdAt: new Date(2026, 9, 11, 9).getTime() },
      { id: "too-old", done: false, sortOrder: 0, createdAt: new Date(2026, 9, 10, 9).getTime() },
      { id: "missing", done: false, sortOrder: 0, createdAt: "bad" },
    ],
    now
  );
  assert.equal(grouped.earlier.ymd, "更早");
  assert.equal(grouped.earlier.distance, "超过一个月");
  assert.deepEqual(
    grouped.recent.map((group) => [group.ymd, group.weekday, group.distance, group.items.map((item) => item.id)]),
    [
      ["2026年11月11日", "周三", "今天", ["today-open", "today-done"]],
      ["2026年11月8日", "周日", "3天前", ["older"]],
      ["2026年10月11日", "周日", "31天前", ["month-edge"]],
      ["日期未知", "", "", ["missing"]],
    ]
  );
  assert.deepEqual(
    grouped.earlier.groups.map((group) => [group.ymd, group.items.map((item) => item.id)]),
    [["2026年10月10日", ["too-old"]]]
  );
});

test("createTodo rejects blank content", async () => {
  await assert.rejects(() => createTodo("  "), /待办内容不能为空/);
});

test("create update complete and delete todo through the backend", async () => {
  const env = installBackendExtension();
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
