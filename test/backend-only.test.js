import assert from "node:assert/strict";
import { test } from "node:test";
import { createCollection, updateCollection, deleteCollection, importJson } from "../js/storage.js";
import { createNote, updateNote, deleteNote } from "../js/notes.js";
import { createTodo, updateTodo, deleteTodo } from "../js/todos.js";
import { addToToolbox, updateToolboxItem, deleteToolboxItem } from "../js/toolbox.js";
import { appendMessage, createSession, deleteSession } from "../js/llm.js";
import { STORAGE_KEY, NOTES_KEY, TODOS_KEY, TOOLBOX_KEY, CHAT_KEY } from "../js/settings.js";
import { installOfflineExtension, installBackendExtension } from "./helpers.js";

const seed = {
  [STORAGE_KEY]: { collections: [{ id: "1", name: "原集合", description: "", groups: [{ id: "2", name: "默认", items: [] }] }] },
  [NOTES_KEY]: { notes: [{ id: "3", content: "原便签", archived: true }] },
  [TODOS_KEY]: { todos: [{ id: "4", content: "原待办", done: false }] },
  [TOOLBOX_KEY]: { items: [{ id: "5", title: "原工具", url: "https://example.com" }] },
  [CHAT_KEY]: { currentSessionId: "6", sessions: [{ id: "6", title: "原对话", messages: [], createdAt: 1, updatedAt: 1 }] },
};

test("offline mutations fail without changing cached business data", async () => {
  const env = installOfflineExtension({ local: structuredClone(seed) });
  try {
    const actions = [
      () => createCollection({ name: "新集合" }), () => updateCollection("1", { name: "新名称" }), () => deleteCollection("1"),
      () => createNote("新便签"), () => updateNote("3", { content: "新内容" }), () => deleteNote("3"),
      () => createTodo("新待办"), () => updateTodo("4", { done: true }), () => deleteTodo("4"),
      () => addToToolbox({ url: "https://new.example" }), () => updateToolboxItem("5", { title: "新工具" }), () => deleteToolboxItem("5"),
      () => createSession("新会话"), () => appendMessage({ role: "user", content: "你好" }), () => deleteSession("6"),
      () => importJson(JSON.stringify({ collections: [{ name: "导入" }] })),
    ];
    for (const action of actions) await assert.rejects(action, /无法连接|导入中断/);
    for (const [key, value] of Object.entries(seed)) assert.deepEqual(env.local.get(key), value, key);
  } finally { env.restoreFetch(); }
});

test("chat creation and messages are saved to the backend", async () => {
  const env = installBackendExtension();
  try {
    const session = await createSession();
    const result = await appendMessage({ role: "user", content: "你好" });
    assert.equal(result.message.content, "你好");
    assert.equal(result.session.id, session.id);
    assert.deepEqual(env.requests.map(({ path, method }) => [path, method]), [
      ["/api/llm-sessions", "POST"], [`/api/llm-sessions/${session.id}/messages`, "POST"],
    ]);
  } finally { env.restoreFetch(); }
});
