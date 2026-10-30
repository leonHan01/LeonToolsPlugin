import * as api from "./api.js";
import { el, icon } from "./dom.js";
import { notifyNoteCreated } from "./feishu.js";
import { mergeDirtyWithRemote, pushDirtyRecords, withBackend } from "./persist.js";
import { NOTES_KEY } from "./settings.js";
import { formatDateTime } from "./storage.js";
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
  const note = fromRemote(await api.createNote({ content: text, archived: false }));
  const state = await loadNotes(); state.notes.push(note); await saveNotes(state);
  notifyNoteCreated(text);
  return note;
}

export async function updateNote(noteId, patch = {}) {
  const state = await loadNotes();
  const note = state.notes.find((item) => String(item.id) === String(noteId));
  if (!note) throw new Error("便签不存在");
  if (!api.isRemoteId(noteId)) throw new Error("旧本地便签尚未同步到后端");
  const content = patch.content != null ? String(patch.content).trim() : note.content;
  if (!content) throw new Error("便签内容不能为空");
  const updated = { ...note, content, archived: patch.archived != null ? Boolean(patch.archived) : note.archived, updatedAt: Date.now(), dirty: false };
  await api.updateNote(noteId, notePayload(updated));
  const latest = await loadNotes(); const index = latest.notes.findIndex((item) => String(item.id) === String(noteId));
  if (index >= 0) latest.notes[index] = updated;
  await saveNotes(latest);
  return updated;
}

export async function deleteNote(noteId) {
  const state = await loadNotes();
  const note = state.notes.find((item) => String(item.id) === String(noteId));
  if (!note) throw new Error("便签不存在");
  if (!note.archived) throw new Error("请先归档再删除便签");
  if (!api.isRemoteId(noteId)) throw new Error("旧本地便签尚未同步到后端");
  await api.deleteNote(noteId);
  const latest = await loadNotes(); latest.notes = latest.notes.filter((item) => String(item.id) !== String(noteId)); await saveNotes(latest);
}

export async function pushLocalNotes() {
  if (!(await api.shouldUseBackend(true))) return false;
  const state = await loadNotes();
  const checkpoint = async (note, oldId) => {
    const latest = await loadNotes();
    const index = latest.notes.findIndex((item) => String(item.id) === String(oldId));
    if (index >= 0) { latest.notes[index] = note; await saveNotes(latest); }
  };
  const ok = await pushDirtyRecords(state.notes, {
    create: (note) => api.createNote(notePayload(note)),
    update: (note) => api.updateNote(note.id, notePayload(note)),
    checkpoint,
  });
  return ok;
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
