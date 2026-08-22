import * as api from "./api.js";
import { el, icon } from "./dom.js";
import { notifyTodoCompleted, notifyTodoCreated } from "./feishu.js";
import { mergeDirtyWithRemote, withBackend } from "./persist.js";
import { TODOS_KEY } from "./settings.js";
import { uid } from "./storage.js";
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
  const state = await loadTodos();
  const item = {
    id: uid(),
    content: text,
    done: false,
    sortOrder: state.todos.length,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    dirty: true,
  };
  state.todos.push(item);
  state.todos = sortTodos(state.todos);
  await saveTodos(state);
  notifyTodoCreated(text);
  if (!(await api.shouldUseBackend())) return item;
  const remote = await withBackend("保存待办失败", async () =>
    fromRemote(await api.createTodo({ content: text, done: item.done, sortOrder: item.sortOrder }))
  );
  if (!remote) return item;
  const index = state.todos.findIndex((todo) => todo.id === item.id);
  if (index >= 0) state.todos[index] = remote;
  state.todos = sortTodos(state.todos);
  await saveTodos(state);
  return remote;
}

export async function updateTodo(todoId, patch) {
  const state = await loadTodos();
  const item = state.todos.find((todo) => String(todo.id) === String(todoId));
  if (!item) throw new Error("待办不存在");
  const wasDone = Boolean(item.done);
  if (patch.content != null) {
    const text = String(patch.content).trim();
    if (!text) throw new Error("待办内容不能为空");
    item.content = text;
  }
  if (patch.done != null) item.done = Boolean(patch.done);
  item.updatedAt = Date.now();
  item.dirty = true;
  state.todos = sortTodos(state.todos);
  await saveTodos(state);
  if (!wasDone && item.done) notifyTodoCompleted(item.content);
  if (api.isRemoteId(todoId) && (await api.shouldUseBackend())) {
    const ok = await withBackend("更新待办失败", () => api.updateTodo(todoId, { content: item.content, done: item.done }));
    if (ok !== undefined) {
      item.dirty = false;
      await saveTodos(state);
    }
  }
  return item;
}

export async function deleteTodo(todoId) {
  const state = await loadTodos();
  state.todos = state.todos.filter((item) => String(item.id) !== String(todoId));
  await saveTodos(state);
  if (api.isRemoteId(todoId) && (await api.shouldUseBackend())) {
    await withBackend("删除待办失败", () => api.deleteTodo(todoId));
  }
}

export async function pushLocalTodos() {
  if (!(await api.shouldUseBackend(true))) return;
  const state = await loadTodos();
  for (const item of [...state.todos]) {
    try {
      if (!api.isRemoteId(item.id)) {
        const remote = await api.createTodo({ content: item.content });
        item.id = String(remote.id);
        if (item.done) await api.updateTodo(item.id, { content: item.content, done: true });
        item.dirty = false;
      } else if (item.dirty) {
        await api.updateTodo(item.id, { content: item.content, done: item.done });
        item.dirty = false;
      }
    } catch {
      /* keep local */
    }
  }
  await saveTodos(state);
}

export function renderTodosPage({ toast, confirmDelete, openSheet, closeSheet }) {
  const page = el("div", { class: "todos-page" });
  const list = el("div", { class: "todo-list" });
  const input = el("input", { class: "input", placeholder: "添加待办，回车保存", id: "todo-input" });
  const addBtn = el("button", { class: "btn primary icon", type: "button", title: "发送" }, icon("send"));

  async function reload() {
    const state = await refreshTodosFromBackend();
    renderList(state.todos);
  }

  function renderList(todos) {
    if (!todos.length) {
      list.replaceChildren(el("div", { class: "empty" }, "还没有待办事项"));
      return;
    }
    list.replaceChildren(
      ...todos.map((item) => {
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
          el("button", { class: "todo-text", type: "button", onClick: () => openEdit(item) }, item.content),
          el(
            "div",
            { class: "todo-actions" },
            el("button", { class: "btn ghost icon", type: "button", title: "编辑", onClick: () => openEdit(item) }, icon("pencil")),
            el("button", { class: "btn ghost icon", type: "button", title: "删除", onClick: () => removeTodo(item) }, icon("trash"))
          )
        );
      })
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
