import * as api from "./api.js";
import { el, icon } from "./dom.js";
import { notifyNoteCreated } from "./feishu.js";
import { mergeDirtyWithRemote, pushDirtyRecords, withBackend } from "./persist.js";
import { NOTES_KEY } from "./settings.js";
import { formatDateTime, uid } from "./storage.js";
import { renderAnalysisBar } from "./work-analysis.js";

function emptyNotes() {
  return { notes: [] };
}

export async function loadNotes() {
  const data = await chrome.storage.local.get(NOTES_KEY);
  const stored = data[NOTES_KEY];
  if (!stored || !Array.isArray(stored.notes)) return emptyNotes();
  return stored;
}

export async function saveNotes(state) {
  await chrome.storage.local.set({ [NOTES_KEY]: state });
}

function fromRemote(note) {
  return {
    id: String(note.id),
    content: note.content || "",
    archived: Boolean(note.archived),
    createdAt: api.parseTime(note.createTime),
    updatedAt: api.parseTime(note.updateTime),
    dirty: false,
  };
}

function notePayload(note) {
  return { content: note.content, archived: Boolean(note.archived) };
}

function sortNotes(notes) {
  return [...notes].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || String(a.id).localeCompare(String(b.id)));
}

export async function refreshNotesFromBackend() {
  const local = await loadNotes();
  if (!(await api.shouldUseBackend(true))) return local;
  const next = await withBackend("加载便签失败", async () => {
    const remote = (await api.listNotes() || []).map(fromRemote);
    const merged = { notes: sortNotes(mergeDirtyWithRemote(local.notes, remote)) };
    await saveNotes(merged);
    return merged;
  });
  return next || local;
}

export async function createNote(content) {
  const text = String(content || "").trim();
  if (!text) throw new Error("便签内容不能为空");
  const state = await loadNotes();
  const note = {
    id: uid(),
    content: text,
    archived: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    dirty: true,
  };
  state.notes.push(note);
  await saveNotes(state);
  notifyNoteCreated(text);
  if (!(await api.shouldUseBackend())) return note;
  const remote = await withBackend("保存便签失败", async () => fromRemote(await api.createNote(notePayload(note))));
  if (!remote) return note;
  const index = state.notes.findIndex((item) => item.id === note.id);
  if (index >= 0) state.notes[index] = remote;
  await saveNotes(state);
  return remote;
}

export async function updateNote(noteId, patch = {}) {
  const state = await loadNotes();
  const note = state.notes.find((item) => String(item.id) === String(noteId));
  if (!note) throw new Error("便签不存在");
  if (patch.content != null) {
    const text = String(patch.content).trim();
    if (!text) throw new Error("便签内容不能为空");
    note.content = text;
  }
  if (patch.archived != null) note.archived = Boolean(patch.archived);
  note.updatedAt = Date.now();
  note.dirty = true;
  await saveNotes(state);
  if (api.isRemoteId(noteId) && (await api.shouldUseBackend())) {
    const ok = await withBackend("更新便签失败", () => api.updateNote(noteId, notePayload(note)));
    if (ok !== undefined) {
      note.dirty = false;
      await saveNotes(state);
    }
  }
  return note;
}

export async function deleteNote(noteId) {
  const state = await loadNotes();
  const note = state.notes.find((item) => String(item.id) === String(noteId));
  if (!note) throw new Error("便签不存在");
  if (!note.archived) throw new Error("请先归档再删除便签");
  state.notes = state.notes.filter((item) => String(item.id) !== String(noteId));
  await saveNotes(state);
  if (api.isRemoteId(noteId) && (await api.shouldUseBackend())) {
    await withBackend("删除便签失败", () => api.deleteNote(noteId));
  }
}

export async function pushLocalNotes() {
  if (!(await api.shouldUseBackend(true))) return;
  const state = await loadNotes();
  await pushDirtyRecords(state.notes, {
    create: (note) => api.createNote(notePayload(note)),
    update: (note) => api.updateNote(note.id, notePayload(note)),
  });
  await saveNotes(state);
}

export function renderNotesPage({ toast, confirmDelete, openSheet, closeSheet }) {
  const page = el("div", { class: "notes-page" });
  const thread = el("div", { class: "notes-thread" });
  const filterTabs = el("div", { class: "notes-filter", role: "tablist" });
  const input = el("textarea", {
    class: "notes-input",
    rows: "1",
    placeholder: "写一条便签，回车发送",
  });
  const sendBtn = el("button", { class: "btn primary icon", type: "button", title: "发送" }, icon("send"));
  const composer = el("div", { class: "notes-composer" }, input, sendBtn);
  let filter = "active";
  let allNotes = [];

  async function reload() {
    const state = await refreshNotesFromBackend();
    allNotes = state.notes;
    render();
  }

  function setFilter(next) {
    filter = next;
    render();
    if (filter === "active") queueMicrotask(() => input.focus());
  }

  function render() {
    renderFilter();
    renderThread();
    composer.hidden = filter === "archived";
  }

  function renderFilter() {
    filterTabs.replaceChildren(
      el(
        "button",
        {
          class: `notes-filter-tab${filter === "active" ? " active" : ""}`,
          type: "button",
          role: "tab",
          "aria-selected": filter === "active" ? "true" : "false",
          onClick: () => setFilter("active"),
        },
        "未归档"
      ),
      el(
        "button",
        {
          class: `notes-filter-tab${filter === "archived" ? " active" : ""}`,
          type: "button",
          role: "tab",
          "aria-selected": filter === "archived" ? "true" : "false",
          onClick: () => setFilter("archived"),
        },
        "已归档"
      )
    );
  }

  function visibleNotes() {
    return allNotes.filter((note) => Boolean(note.archived) === (filter === "archived"));
  }

  function renderThread() {
    const notes = visibleNotes();
    if (!notes.length) {
      thread.replaceChildren(
        el(
          "div",
          { class: "notes-empty" },
          filter === "archived" ? "还没有已归档的便签。" : "还没有便签，在下方输入后发送。"
        )
      );
      return;
    }
    thread.replaceChildren(
      ...notes.map((note) => {
        const actions = note.archived
          ? [
              el("button", { class: "btn ghost icon", type: "button", title: "取消归档", onClick: () => toggleArchive(note, false) }, icon("unarchive")),
              el("button", { class: "btn ghost icon", type: "button", title: "删除", onClick: () => removeNote(note) }, icon("trash")),
            ]
          : [
              el("button", { class: "btn ghost icon", type: "button", title: "编辑", onClick: () => openEdit(note) }, icon("pencil")),
              el("button", { class: "btn ghost icon", type: "button", title: "归档", onClick: () => toggleArchive(note, true) }, icon("archive")),
            ];
        return el(
          "article",
          { class: `note-bubble${note.archived ? " archived" : ""}` },
          el("div", { class: "note-text" }, note.content),
          el(
            "div",
            { class: "note-meta" },
            el("span", {}, formatDateTime(note.updatedAt || note.createdAt)),
            el("div", { class: "note-actions" }, ...actions)
          )
        );
      })
    );
    thread.scrollTop = thread.scrollHeight;
  }

  function openEdit(note) {
    const editor = el("textarea", { class: "textarea", text: note.content });
    openSheet(
      "编辑便签",
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
                await updateNote(note.id, { content: editor.value });
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

  async function toggleArchive(note, archived) {
    try {
      await updateNote(note.id, { archived });
      await reload();
    } catch (error) {
      toast(error instanceof Error ? error.message : "更新失败");
    }
  }

  async function removeNote(note) {
    const ok = await confirmDelete(`确定删除这条便签吗？此操作不可恢复。`);
    if (!ok) return;
    try {
      await deleteNote(note.id);
      await reload();
    } catch (error) {
      toast(error instanceof Error ? error.message : "删除失败");
    }
  }

  async function send() {
    const text = input.value.trim();
    if (!text) return;
    sendBtn.disabled = true;
    try {
      await createNote(text);
      input.value = "";
      input.style.height = "auto";
      await reload();
    } catch (error) {
      toast(error instanceof Error ? error.message : "发送失败");
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  }

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
    renderAnalysisBar({ toast, openSheet, closeSheet, leading: filterTabs }),
    thread,
    composer
  );
  reload();
  queueMicrotask(() => input.focus());
  return page;
}
