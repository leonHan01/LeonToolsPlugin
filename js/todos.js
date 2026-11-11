import * as api from "./api.js";
import { el, icon } from "./dom.js";
import { notifyTodoCompleted, notifyTodoCreated } from "./feishu.js";
import { mergeDirtyWithRemote, pushDirtyRecords, withBackend } from "./persist.js";
import { TODOS_KEY } from "./settings.js";
import { renderAnalysisBar } from "./work-analysis.js";

function emptyTodos() {
  return { todos: [] };
}

export async function loadTodos() {
  const data = await chrome.storage.local.get(TODOS_KEY);
  const stored = data[TODOS_KEY];
  if (!stored || !Array.isArray(stored.todos)) return emptyTodos();
  return stored;
}

export async function saveTodos(state) {
  await chrome.storage.local.set({ [TODOS_KEY]: state });
}

function fromRemote(item) {
  return {
    id: String(item.id),
    content: item.content || "",
    done: Boolean(item.done),
    sortOrder: item.sortOrder ?? 0,
    createdAt: api.parseTime(item.createTime),
    updatedAt: api.parseTime(item.updateTime),
    dirty: false,
  };
}

function sortTodos(todos) {
  return [...todos].sort((a, b) => Number(a.done) - Number(b.done) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function startOfLocalDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return NaN;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function dayDistance(diff) {
  if (diff === 0) return "今天";
  if (diff > 0) return `${diff}天前`;
  return `${-diff}天后`;
}

function monthCutoff(now) {
  const today = new Date(startOfLocalDay(now));
  const day = today.getDate();
  const previous = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastDay = new Date(previous.getFullYear(), previous.getMonth() + 1, 0).getDate();
  previous.setDate(Math.min(day, lastDay));
  return previous.getTime();
}

function sortTodoItems(items) {
  items.sort((a, b) => Number(a.done) - Number(b.done) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return items;
}

function compareDayGroups(a, b) {
  if (a.day == null) return 1;
  if (b.day == null) return -1;
  return b.day - a.day;
}

export function groupTodosByCreatedDate(todos, now = Date.now()) {
  const today = startOfLocalDay(now);
  const cutoff = monthCutoff(now);
  const groups = new Map();
  for (const item of todos) {
    const day = startOfLocalDay(item.createdAt);
    const key = Number.isNaN(day) ? "unknown" : String(day);
    if (!groups.has(key)) {
      if (Number.isNaN(day)) {
        groups.set(key, { key, day: null, ymd: "日期未知", weekday: "", distance: "", items: [] });
      } else {
        const date = new Date(day);
        const diff = Math.round((today - day) / 86400000);
        groups.set(key, {
          key,
          day,
          ymd: `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`,
          weekday: WEEKDAYS[date.getDay()],
          distance: dayDistance(diff),
          items: [],
        });
      }
    }
    groups.get(key).items.push(item);
  }
  for (const group of groups.values()) sortTodoItems(group.items);
  const ordered = [...groups.values()].sort(compareDayGroups);
  const recent = ordered.filter((group) => group.day == null || group.day >= cutoff);
  const earlierDays = ordered.filter((group) => group.day != null && group.day < cutoff);
  return {
    recent,
    earlier: earlierDays.length
      ? { key: "earlier", ymd: "更早", distance: "超过一个月", groups: earlierDays }
      : null,
  };
}

const TODO_URL = /https?:\/\/[^\s<>"']+/gi;

function pushTodoText(parts, value) {
  if (!value) return;
  const last = parts[parts.length - 1];
  if (last?.text != null) last.text += value;
  else parts.push({ text: value });
}

export function splitTodoText(content) {
  const text = String(content || "");
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(TODO_URL)) {
    const raw = match[0];
    const url = raw.replace(/[),.;:!?，。；：！？、]+$/u, "");
    if (!url) continue;
    if (match.index > last) pushTodoText(parts, text.slice(last, match.index));
    parts.push({ url });
    const end = match.index + raw.length;
    if (url.length < raw.length) pushTodoText(parts, raw.slice(url.length));
    last = end;
  }
  if (last < text.length) pushTodoText(parts, text.slice(last));
  return parts.length ? parts : [{ text }];
}

async function openTodoUrl(url) {
  const result = await chrome.runtime.sendMessage({ type: "OPEN_OR_FOCUS", url, active: true });
  if (result?.error) throw new Error(result.error);
}

export async function refreshTodosFromBackend() {
  const local = await loadTodos();
  if (!(await api.shouldUseBackend(true))) return local;
  const next = await withBackend("加载待办失败", async () => {
    const remote = (await api.listTodos() || []).map(fromRemote);
    const merged = { todos: sortTodos(mergeDirtyWithRemote(local.todos, remote)) };
    await saveTodos(merged);
    return merged;
  });
  return next || local;
}

export async function createTodo(content) {
  const text = String(content || "").trim();
  if (!text) throw new Error("待办内容不能为空");
  const item = fromRemote(await api.createTodo({ content: text, done: false }));
  const state = await loadTodos(); state.todos.push(item); state.todos = sortTodos(state.todos); await saveTodos(state);
  notifyTodoCreated(text);
  return item;
}

export async function updateTodo(todoId, patch) {
  const state = await loadTodos(); const item = state.todos.find((todo) => String(todo.id) === String(todoId));
  if (!item) throw new Error("待办不存在");
  if (!api.isRemoteId(todoId)) throw new Error("旧本地待办尚未同步到后端");
  const content = patch.content != null ? String(patch.content).trim() : item.content;
  if (!content) throw new Error("待办内容不能为空");
  const updated = { ...item, content, done: patch.done != null ? Boolean(patch.done) : item.done, updatedAt: Date.now(), dirty: false };
  await api.updateTodo(todoId, { content: updated.content, done: updated.done });
  const latest = await loadTodos(); const index = latest.todos.findIndex((todo) => String(todo.id) === String(todoId));
  if (index >= 0) latest.todos[index] = updated;
  latest.todos = sortTodos(latest.todos); await saveTodos(latest);
  if (!item.done && updated.done) notifyTodoCompleted(updated.content);
  return updated;
}

export async function deleteTodo(todoId) {
  if (!api.isRemoteId(todoId)) throw new Error("旧本地待办尚未同步到后端");
  await api.deleteTodo(todoId);
  const state = await loadTodos(); state.todos = state.todos.filter((item) => String(item.id) !== String(todoId)); await saveTodos(state);
}

export async function pushLocalTodos() {
  if (!(await api.shouldUseBackend(true))) return false;
  const state = await loadTodos();
  const checkpoint = async (item, oldId) => {
    const latest = await loadTodos();
    const index = latest.todos.findIndex((entry) => String(entry.id) === String(oldId));
    if (index >= 0) { latest.todos[index] = item; await saveTodos(latest); }
  };
  const ok = await pushDirtyRecords(state.todos, {
    create: async (item, oldId) => {
      const remote = await api.createTodo({ content: item.content });
      item.id = String(remote.id);
      await checkpoint(item, oldId);
      if (item.done) await api.updateTodo(String(remote.id), { content: item.content, done: true });
      return remote;
    },
    update: (item) => api.updateTodo(item.id, { content: item.content, done: item.done }),
    checkpoint: (item, oldId) => checkpoint(item, api.isRemoteId(oldId) ? oldId : item.id),
  });
  return ok;
}

export function renderTodosPage({ toast, confirmDelete, openSheet, closeSheet }) {
  const page = el("div", { class: "todos-page" });
  const list = el("div", { class: "todo-list" });
  const input = el("input", { class: "input", placeholder: "添加待办，回车保存", id: "todo-input" });
  const addBtn = el("button", { class: "btn primary icon", type: "button", title: "发送" }, icon("send"));
  const collapsed = new Set(["earlier"]);

  async function reload() {
    const state = await refreshTodosFromBackend();
    renderList(state.todos);
  }

  function renderList(todos) {
    if (!todos.length) {
      list.replaceChildren(el("div", { class: "empty" }, "还没有待办事项"));
      return;
    }
    const grouped = groupTodosByCreatedDate(todos);
    const sections = grouped.recent.map((group) => daySection(group));
    if (grouped.earlier) {
      sections.push(
        foldSection(grouped.earlier, grouped.earlier.groups.map((group) => daySection(group, true)))
      );
    }
    list.replaceChildren(...sections);
  }

  function daySection(group, nested = false) {
    return foldSection(group, group.items.map((item) => todoRow(item)), nested);
  }

  function foldSection(group, bodyChildren, nested = false) {
    const open = !collapsed.has(group.key);
    const mark = icon("chevronLeft");
    mark.classList.add("todo-fold");
    const header = el(
      "button",
      {
        class: "todo-day",
        type: "button",
        "aria-expanded": String(open),
        onClick: () => {
          const next = !collapsed.has(group.key);
          if (next) collapsed.delete(group.key);
          else collapsed.add(group.key);
          section.classList.toggle("collapsed", !next);
          header.setAttribute("aria-expanded", String(next));
        },
      },
      mark,
      el("span", { class: "todo-day-date" }, group.ymd),
      group.weekday ? el("span", {}, group.weekday) : null,
      group.distance ? el("span", { class: "todo-day-distance" }, group.distance) : null
    );
    const section = el(
      "section",
      { class: `todo-group${open ? "" : " collapsed"}${nested ? " nested" : ""}` },
      header,
      el("div", { class: "todo-group-body" }, ...bodyChildren)
    );
    return section;
  }

  function todoRow(item) {
    const box = el("input", { type: "checkbox", checked: item.done });
    box.addEventListener("change", async () => {
      try {
        await updateTodo(item.id, { done: box.checked });
        await reload();
      } catch (error) {
        toast(error instanceof Error ? error.message : "更新失败");
      }
    });
    return el(
      "article",
      { class: `todo-item ${item.done ? "done" : ""}` },
      box,
      todoLabel(item),
      el(
        "div",
        { class: "todo-actions" },
        el("button", { class: "btn ghost icon", type: "button", title: "编辑", onClick: () => openEdit(item) }, icon("pencil")),
        el("button", { class: "btn ghost icon", type: "button", title: "删除", onClick: () => removeTodo(item) }, icon("trash"))
      )
    );
  }

  function todoLabel(item) {
    const parts = splitTodoText(item.content);
    if (!parts.some((part) => part.url)) {
      return el("button", { class: "todo-text", type: "button", onClick: () => openEdit(item) }, item.content);
    }
    return el(
      "div",
      { class: "todo-text" },
      ...parts.map((part) =>
        part.url
          ? el(
              "button",
              {
                class: "todo-link",
                type: "button",
                title: part.url,
                onClick: async (event) => {
                  event.stopPropagation();
                  try {
                    await openTodoUrl(part.url);
                  } catch (error) {
                    toast(error instanceof Error ? error.message : "无法打开链接");
                  }
                },
              },
              "[链接]"
            )
          : el("button", { class: "todo-body", type: "button", onClick: () => openEdit(item) }, part.text)
      )
    );
  }

  function openEdit(item) {
    const editor = el("textarea", { class: "textarea", text: item.content });
    openSheet(
      "编辑待办",
      el("div", { class: "field" }, el("label", {}, "内容"), editor),
      [
        el("button", { class: "btn ghost", type: "button", onClick: closeSheet }, "取消"),
        el(
          "button",
          {
            class: "btn primary",
            type: "button",
            onClick: async () => {
              try {
                await updateTodo(item.id, { content: editor.value });
                closeSheet();
                await reload();
              } catch (error) {
                toast(error instanceof Error ? error.message : "保存失败");
              }
            },
          },
          "保存"
        ),
      ]
    );
    editor.focus();
  }

  async function removeTodo(item) {
    const ok = await confirmDelete(`确定删除待办「${item.content}」吗？此操作不可恢复。`);
    if (!ok) return;
    await deleteTodo(item.id);
    await reload();
  }

  async function add() {
    const text = input.value.trim();
    if (!text) return;
    addBtn.disabled = true;
    try {
      await createTodo(text);
      input.value = "";
      await reload();
    } catch (error) {
      toast(error instanceof Error ? error.message : "添加失败");
    } finally {
      addBtn.disabled = false;
      input.focus();
    }
  }

  addBtn.addEventListener("click", add);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      add();
    }
  });

  page.append(
    renderAnalysisBar({ toast, openSheet, closeSheet }),
    list,
    el("div", { class: "notes-composer" }, input, addBtn)
  );
  reload();
  queueMicrotask(() => input.focus());
  return page;
}
