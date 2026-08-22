import * as api from "./api.js";
import { el, icon } from "./dom.js";
import { withBackend } from "./persist.js";
import { CHAT_KEY, getDeepseekKey } from "./settings.js";
import { formatDateTime, uid } from "./storage.js";

const SYSTEM_PROMPT = "You are a helpful assistant.";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const MODEL = "deepseek-v4-flash";
const PRIOR_USER_CONTEXT = 5;

function emptyStore() {
  return { currentSessionId: null, sessions: [] };
}

function clipTitle(text) {
  return api.clip(String(text || "").trim().replace(/\s+/g, " "), 40);
}

export function fromRemoteMessage(message) {
  return {
    id: String(message.id),
    role: message.role,
    content: message.content || "",
    reasoning: message.reasoningContent || "",
    createdAt: api.parseTime(message.createTime),
    dirty: false,
  };
}

export function fromRemoteSession(session, messages = []) {
  const mapped = messages.map(fromRemoteMessage);
  return {
    id: String(session.id),
    title: session.title || "新对话",
    createdAt: api.parseTime(session.createTime),
    updatedAt: api.parseTime(session.updateTime),
    messageCount: session.messageCount ?? mapped.length,
    messages: mapped,
  };
}

function localSession({ title = "新对话", messages = [] } = {}) {
  const now = Date.now();
  return {
    id: uid(),
    title,
    createdAt: now,
    updatedAt: now,
    messageCount: messages.length,
    messages,
  };
}

function normalizeSession(session) {
  const messages = Array.isArray(session.messages) ? session.messages : [];
  return {
    id: String(session.id),
    title: session.title || "新对话",
    createdAt: session.createdAt || Date.now(),
    updatedAt: session.updatedAt || session.createdAt || Date.now(),
    messageCount: session.messageCount ?? messages.length,
    messages,
  };
}

export function migrateStore(stored) {
  if (!stored || typeof stored !== "object") return emptyStore();
  if (Array.isArray(stored.sessions)) {
    const sessions = stored.sessions.map(normalizeSession);
    const currentId = stored.currentSessionId != null ? String(stored.currentSessionId) : null;
    const current = sessions.some((item) => item.id === currentId) ? currentId : sessions[0]?.id || null;
    return { currentSessionId: current, sessions };
  }
  if (Array.isArray(stored.messages) && stored.messages.length) {
    const firstUser = stored.messages.find((item) => item.role === "user");
    const session = localSession({
      title: clipTitle(firstUser?.content) || "历史对话",
      messages: stored.messages,
    });
    session.createdAt = stored.messages[0]?.createdAt || session.createdAt;
    session.updatedAt = stored.messages.at(-1)?.createdAt || session.updatedAt;
    return { currentSessionId: session.id, sessions: [session] };
  }
  return emptyStore();
}

export async function loadChat() {
  const data = await chrome.storage.local.get(CHAT_KEY);
  return migrateStore(data[CHAT_KEY]);
}

export async function saveChat(store) {
  await chrome.storage.local.set({ [CHAT_KEY]: store });
}

function findSession(store, sessionId) {
  return store.sessions.find((item) => String(item.id) === String(sessionId)) || null;
}

function sortedSessions(store) {
  return [...store.sessions].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function currentSession(store) {
  return findSession(store, store.currentSessionId);
}

function upsertSession(store, session) {
  const index = store.sessions.findIndex((item) => String(item.id) === String(session.id));
  if (index >= 0) store.sessions[index] = session;
  else store.sessions.unshift(session);
}

function priorUserQuestions(messages) {
  const users = messages.filter((item) => item.role === "user" && String(item.content || "").trim());
  const current = users.at(-1);
  const prior = users.slice(0, -1).slice(-PRIOR_USER_CONTEXT);
  return { prior, current };
}

export function buildChatCompletionsMessages(sessionMessages) {
  const { prior, current } = priorUserQuestions(sessionMessages);
  if (!current) throw new Error("没有可发送的问题");
  let system = SYSTEM_PROMPT;
  if (prior.length) {
    system +=
      "\n\n同一会话中用户之前的问题（仅作为上下文，不要逐条回答）：\n" +
      prior.map((item, index) => `${index + 1}. ${item.content}`).join("\n");
  }
  return [
    { role: "system", content: system },
    { role: "user", content: current.content },
  ];
}

async function ensureRemoteSession(store, session) {
  if (!(await api.shouldUseBackend()) || api.isRemoteId(session.id)) return session;
  const remote = await api.createChatSession({ title: session.title || "新对话" });
  const oldId = session.id;
  const next = {
    ...session,
    id: String(remote.id),
    title: session.title || remote.title || "新对话",
  };
  store.sessions = store.sessions.filter((item) => String(item.id) !== String(oldId));
  upsertSession(store, next);
  if (String(store.currentSessionId) === String(oldId)) store.currentSessionId = next.id;
  return next;
}

async function pushSessionMessages(session) {
  if (!api.isRemoteId(session.id)) return session;
  for (const message of session.messages) {
    if (!String(message.content || "").trim()) continue;
    if (!message.dirty && api.isRemoteId(message.id)) continue;
    const saved = await api.addChatMessage(session.id, {
      role: message.role,
      content: message.content,
      reasoningContent: message.reasoning || "",
    });
    Object.assign(message, fromRemoteMessage(saved));
  }
  session.messageCount = session.messages.length;
  return session;
}

export function mergeSession(localSession, remoteSession) {
  const remote = fromRemoteSession(remoteSession, remoteSession.messages || []);
  if (!localSession) return remote;
  const extra = localSession.messages.filter((item) => item.dirty || !api.isRemoteId(item.id));
  if (extra.length) remote.messages = [...remote.messages, ...extra];
  if (localSession.dirty || (localSession.title && localSession.title !== "新对话" && extra.length)) {
    remote.title = localSession.title || remote.title;
  }
  remote.messageCount = remote.messages.length || remote.messageCount;
  return remote;
}

export async function refreshSessionsFromBackend() {
  const local = await loadChat();
  if (!(await api.shouldUseBackend(true))) return local;
  const store = await withBackend("加载对话失败", async () => {
    const remoteList = await api.listChatSessionsFull();
    const leftover = local.sessions.filter((item) => !api.isRemoteId(item.id));
    const leftoverIds = new Set(leftover.map((item) => String(item.id)));
    const sessions = [
      ...leftover,
      ...(remoteList || [])
        .filter((item) => !leftoverIds.has(String(item.id)))
        .map((item) => mergeSession(findSession(local, item.id), item)),
    ];
    const next = { currentSessionId: local.currentSessionId, sessions };
    if (!findSession(next, next.currentSessionId)) {
      next.currentSessionId = sortedSessions(next)[0]?.id || null;
    }
    await saveChat(next);
    return next;
  });
  return store || local;
}

export async function pushLocalSessions() {
  if (!(await api.shouldUseBackend(true))) return;
  const store = await loadChat();
  await withBackend("同步对话失败", async () => {
    for (const session of [...store.sessions]) {
      const current = findSession(store, session.id) || session;
      if (!current.messages.length && !api.isRemoteId(current.id)) continue;
      const remoteSession = await ensureRemoteSession(store, current);
      await pushSessionMessages(remoteSession);
    }
    await saveChat(store);
    return true;
  });
}

export async function createSession(title = "新对话") {
  const label = String(title || "新对话").trim() || "新对话";
  const store = await loadChat();
  if (label === "新对话") {
    const current = currentSession(store);
    if (current && !current.messages.length) {
      store.currentSessionId = current.id;
      await saveChat(store);
      return current;
    }
  }
  store.sessions = store.sessions.filter((item) => item.messages.length || api.isRemoteId(item.id));
  let session = localSession({ title: label });
  store.sessions.unshift(session);
  store.currentSessionId = session.id;
  await saveChat(store);
  if (await api.shouldUseBackend()) {
    const remote = await withBackend("新建对话失败", async () => {
      const next = await ensureRemoteSession(store, session);
      await saveChat(store);
      return next;
    });
    if (remote) session = remote;
  }
  return session;
}

export async function loadSession(sessionId) {
  const store = await loadChat();
  let session = findSession(store, sessionId);
  if (!session) throw new Error("对话不存在");
  if (await api.shouldUseBackend()) {
    const hydrated = await withBackend("加载对话失败", async () => {
      let next = await ensureRemoteSession(store, session);
      await pushSessionMessages(next);
      if (api.isRemoteId(next.id)) {
        next = mergeSession(next, await api.getChatSession(next.id));
      }
      upsertSession(store, next);
      return next;
    });
    if (hydrated) session = hydrated;
  }
  store.currentSessionId = session.id;
  await saveChat(store);
  return session;
}

export async function deleteSession(sessionId) {
  const store = await loadChat();
  const session = findSession(store, sessionId);
  if (!session) return store;
  if (await api.shouldUseBackend() && api.isRemoteId(session.id)) {
    await withBackend("删除对话失败", () => api.deleteChatSession(session.id));
  }
  store.sessions = store.sessions.filter((item) => String(item.id) !== String(session.id));
  if (String(store.currentSessionId) === String(session.id)) {
    store.currentSessionId = sortedSessions(store)[0]?.id || null;
  }
  await saveChat(store);
  return store;
}

export async function appendMessage(partial) {
  let store = await loadChat();
  let session = currentSession(store);
  if (!session) {
    await createSession();
    store = await loadChat();
    session = currentSession(store);
  }
  if (!session) throw new Error("请先新建对话");
  const message = {
    id: uid(),
    role: partial.role,
    content: partial.content || "",
    reasoning: partial.reasoning || "",
    createdAt: Date.now(),
    dirty: true,
  };
  session.messages.push(message);
  session.messageCount = session.messages.length;
  session.updatedAt = Date.now();
  if (message.role === "user" && (session.title === "新对话" || !session.title)) {
    session.title = clipTitle(message.content) || "新对话";
  }
  upsertSession(store, session);
  store.currentSessionId = session.id;
  await saveChat(store);
  if (await api.shouldUseBackend()) {
    await withBackend("保存对话失败", async () => {
      session = await ensureRemoteSession(store, session);
      await pushSessionMessages(session);
      await saveChat(store);
      return true;
    });
  }
  return { session, message };
}

export async function requestChatCompletions(messages) {
  const apiKey = await getDeepseekKey();
  if (!apiKey) {
    throw new Error("请先在设置里填写 DeepSeek API Key");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000);
  let response;
  try {
    response = await fetch(DEEPSEEK_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        thinking: { type: "disabled" },
        stream: false,
      }),
    });
  } finally {
    clearTimeout(timer);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error?.message || payload.message || `HTTP ${response.status}`;
    throw new Error(message);
  }
  const choice = payload.choices?.[0]?.message || {};
  return {
    content: String(choice.content || "").trim() || "(空回复)",
    reasoning: String(choice.reasoning_content || "").trim(),
  };
}

export async function completeChat(sessionMessages) {
  return requestChatCompletions(buildChatCompletionsMessages(sessionMessages));
}

export async function completePrompt({ system, user }) {
  return requestChatCompletions([
    { role: "system", content: system },
    { role: "user", content: user },
  ]);
}

export function renderChatPage({ toast, confirmDelete, openSheet, closeSheet }) {
  const page = el("div", { class: "notes-page chat-page" });
  const titleEl = el("div", { class: "chat-session-title ellipsis" }, "新对话");
  const thread = el("div", { class: "notes-thread chat-thread" });
  const input = el("textarea", {
    class: "notes-input",
    rows: "1",
    placeholder: "输入消息，回车发送",
  });
  const sendBtn = el("button", { class: "btn primary icon", type: "button", title: "发送" }, icon("send"));
  const newBtn = el("button", { class: "btn ghost", type: "button", title: "新建对话" }, icon("plus"), "新建");
  const historyBtn = el("button", { class: "btn ghost", type: "button", title: "查看对话历史" }, icon("clock"), "历史");

  async function reload() {
    const store = await refreshSessionsFromBackend();
    renderStore(store);
  }

  function renderStore(store, extra = null) {
    const session = currentSession(store);
    titleEl.textContent = session?.title || "新对话";
    titleEl.title = session?.title || "新对话";
    const messages = extra ? [...(session?.messages || []), extra] : session?.messages || [];
    if (!messages.length) {
      thread.replaceChildren(
        el("div", { class: "notes-empty" }, "和 DeepSeek 对话。新建开始一轮，历史里可加载之前的会话。")
      );
      return;
    }
    thread.replaceChildren(...messages.map((message) => bubble(message)));
    thread.scrollTop = thread.scrollHeight;
  }

  function bubble(message) {
    const node = el("article", { class: `note-bubble chat-bubble ${message.role}` });
    if (message.reasoning) {
      node.append(
        el(
          "details",
          { class: "chat-thinking" },
          el("summary", {}, "思考过程"),
          el("div", { class: "note-text" }, message.reasoning)
        )
      );
    }
    node.append(el("div", { class: "note-text" }, message.content || (message.pending ? "正在回复…" : "")));
    return node;
  }

  async function send() {
    const text = input.value.trim();
    if (!text) return;
    sendBtn.disabled = true;
    input.value = "";
    input.style.height = "auto";
    try {
      await appendMessage({ role: "user", content: text });
      const store = await loadChat();
      renderStore(store, { role: "assistant", content: "正在回复…", pending: true });
      const session = currentSession(store);
      if (!session) throw new Error("请先新建对话");
      const reply = await completeChat(session.messages);
      await appendMessage({ role: "assistant", content: reply.content, reasoning: reply.reasoning });
      await reload();
    } catch (error) {
      toast(error instanceof Error ? error.message : "发送失败");
      await reload();
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  }

  async function openHistory() {
    const body = el("div", { class: "chat-history-list" });

    async function fill() {
      const store = await refreshSessionsFromBackend();
      const sessions = sortedSessions(store);
      if (!sessions.length) {
        body.replaceChildren(el("div", { class: "notes-empty" }, "还没有对话历史"));
        return;
      }
      body.replaceChildren(
        ...sessions.map((session) => {
          const active = String(session.id) === String(store.currentSessionId);
          const row = el("div", { class: `chat-history-item${active ? " active" : ""}` });
          const main = el(
            "button",
            { class: "chat-history-main", type: "button" },
            el("strong", { class: "ellipsis" }, session.title || "新对话"),
            el(
              "small",
              { class: "muted" },
              `${formatDateTime(session.updatedAt || session.createdAt)} · ${session.messageCount ?? session.messages.length ?? 0} 条消息${active ? " · 当前" : ""}`
            )
          );
          const del = el("button", { class: "btn ghost icon", type: "button", title: "删除对话" }, icon("trash"));
          main.addEventListener("click", async () => {
            try {
              await loadSession(session.id);
              closeSheet();
              await reload();
            } catch (error) {
              toast(error instanceof Error ? error.message : "加载对话失败");
            }
          });
          del.addEventListener("click", async (event) => {
            event.stopPropagation();
            const ok = await confirmDelete(`确定删除对话「${session.title || "新对话"}」吗？此操作不可恢复。`);
            if (!ok) {
              openHistory();
              return;
            }
            await deleteSession(session.id);
            await reload();
            openHistory();
          });
          row.append(main, del);
          return row;
        })
      );
    }

    openSheet("对话历史", body, [el("button", { class: "btn ghost", type: "button", onClick: closeSheet }, "关闭")]);
    await fill();
  }

  newBtn.addEventListener("click", async () => {
    await createSession();
    await reload();
    input.focus();
  });
  historyBtn.addEventListener("click", openHistory);
  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  });

  page.append(
    el("div", { class: "chat-toolbar" }, titleEl, newBtn, historyBtn),
    thread,
    el("div", { class: "notes-composer" }, input, sendBtn)
  );
  reload();
  queueMicrotask(() => input.focus());
  return page;
}
