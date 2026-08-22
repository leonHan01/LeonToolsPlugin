import assert from "node:assert/strict";
import { test } from "node:test";
import { buildChatCompletionsMessages, fromRemoteSession, mergeSession, migrateStore } from "../js/llm.js";

test("migrateStore wraps legacy messages into a session", () => {
  const store = migrateStore({
    messages: [
      { id: "1", role: "user", content: "你好", createdAt: 1 },
      { id: "2", role: "assistant", content: "您好", createdAt: 2 },
    ],
  });
  assert.equal(store.sessions.length, 1);
  assert.equal(store.sessions[0].title, "你好");
  assert.equal(store.sessions[0].messages.length, 2);
  assert.ok(store.currentSessionId);
});

test("migrateStore keeps current session id", () => {
  const store = migrateStore({
    currentSessionId: "a",
    sessions: [
      { id: "a", title: "工作分析", messages: [] },
      { id: "b", title: "其它", messages: [] },
    ],
  });
  assert.equal(store.currentSessionId, "a");
});

test("buildChatCompletionsMessages uses last five prior user questions", () => {
  const history = [];
  for (let index = 1; index <= 8; index += 1) {
    history.push({ role: "user", content: `Q${index}` });
    history.push({ role: "assistant", content: `A${index}` });
  }
  const messages = buildChatCompletionsMessages(history);
  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /Q3/);
  assert.match(messages[0].content, /Q7/);
  assert.doesNotMatch(messages[0].content, /Q2\b/);
  assert.equal(messages[1].role, "user");
  assert.equal(messages[1].content, "Q8");
});

test("buildChatCompletionsMessages rejects empty user history", () => {
  assert.throws(() => buildChatCompletionsMessages([{ role: "assistant", content: "hi" }]), /没有可发送的问题/);
});

test("buildChatCompletionsMessages has no prior context for first question", () => {
  const messages = buildChatCompletionsMessages([{ role: "user", content: "你好" }]);
  assert.equal(messages[0].content, "You are a helpful assistant.");
  assert.equal(messages[1].content, "你好");
});

test("migrateStore falls back when current session is missing", () => {
  const store = migrateStore({
    currentSessionId: "missing",
    sessions: [{ id: "a", title: "工作分析", messages: [] }],
  });
  assert.equal(store.currentSessionId, "a");
  assert.deepEqual(migrateStore(null), { currentSessionId: null, sessions: [] });
});

test("fromRemoteSession and mergeSession keep dirty local messages", () => {
  const remote = fromRemoteSession(
    { id: 4, title: "新对话", createTime: "2026-08-22T10:00:00", updateTime: "2026-08-22T11:00:00" },
    [{ id: 1, role: "user", content: "Q1", createTime: "2026-08-22T10:00:00" }]
  );
  assert.equal(remote.id, "4");
  assert.equal(remote.messages[0].dirty, false);
  const merged = mergeSession(
    { id: "4", title: "工作分析", dirty: true, messages: [{ id: "uuid", role: "user", content: "本地", dirty: true }] },
    { id: 4, title: "新对话", messages: [{ id: 1, role: "user", content: "Q1" }] }
  );
  assert.equal(merged.title, "工作分析");
  assert.equal(merged.messages.length, 2);
  assert.equal(merged.messages[1].content, "本地");
});
