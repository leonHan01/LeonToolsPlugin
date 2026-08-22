import * as api from "./api.js";
import { el, icon } from "./dom.js";
import { notifyNoteCreated } from "./feishu.js";
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
    createdAt: api.parseTime(note.createTime),
    updatedAt: api.parseTime(note.updateTime),
    dirty: false,
  };
}

function sortNotes(notes) {
  return [...notes].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || String(a.id).localeCompare(String(b.id)));
}

export async function refreshNotesFromBackend() {
  const local = await loadNotes();
  if (!(await api.shouldUseBackend(true))) return local;
  try {
    const remote = (await api.listNotes() || []).map(fromRemote);
    const kept = local.notes.filter((note) => !api.isRemoteId(note.id) || note.dirty);
    const keptRemoteIds = new Set(kept.filter((note) => api.isRemoteId(note.id)).map((note) => String(note.id)));
    const next = {
      notes: sortNotes([...kept, ...remote.filter((note) => !keptRemoteIds.has(String(note.id)))]),
    };
    await saveNotes(next);
    await api.markAvailability(true);
    return next;
  } catch (error) {
    await api.markAvailability(false, error instanceof Error ? error.message : "加载便签失败");
    return local;
  }
}

export async function createNote(content) {
  const text = String(content || "").trim();
  if (!text) throw new Error("便签内容不能为空");
  const state = await loadNotes();
  const note = {
    id: uid(),
    content: text,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    dirty: true,
  };
  state.notes.push(note);
  await saveNotes(state);
  notifyNoteCreated(text);
  if (await api.shouldUseBackend()) {
    try {
      const remote = fromRemote(await api.createNote({ content: text }));
      const index = state.notes.findIndex((item) => item.id === note.id);
      if (index >= 0) state.notes[index] = remote;
      await saveNotes(state);
      await api.markAvailability(true);
      return remote;
    } catch (error) {
      await api.markAvailability(false, error instanceof Error ? error.message : "保存便签失败");
    }
  }
  return note;
}

export async function updateNote(noteId, content) {
  const text = String(content || "").trim();
  if (!text) throw new Error("便签内容不能为空");
  const state = await loadNotes();
  const note = state.notes.find((item) => String(item.id) === String(noteId));
  if (!note) throw new Error("便签不存在");
  note.content = text;
  note.updatedAt = Date.now();
  note.dirty = true;
  await saveNotes(state);
  if (api.isRemoteId(noteId) && (await api.shouldUseBackend())) {
    try {
      await api.updateNote(noteId, { content: text });
      note.dirty = false;
      await saveNotes(state);
      await api.markAvailability(true);
    } catch (error) {
      await api.markAvailability(false, error instanceof Error ? error.message : "更新便签失败");
    }
  }
  return note;
}

export async function deleteNote(noteId) {
  const state = await loadNotes();
  state.notes = state.notes.filter((item) => String(item.id) !== String(noteId));
  await saveNotes(state);
  if (api.isRemoteId(noteId) && (await api.shouldUseBackend())) {
    try {
      await api.deleteNote(noteId);
      await api.markAvailability(true);
    } catch (error) {
      await api.markAvailability(false, error instanceof Error ? error.message : "删除便签失败");
    }
  }
}

export async function pushLocalNotes() {
  if (!(await api.shouldUseBackend(true))) return;
  const state = await loadNotes();
  for (const note of [...state.notes]) {
    try {
      if (!api.isRemoteId(note.id)) {
        const remote = await api.createNote({ content: note.content });
        note.id = String(remote.id);
        note.dirty = false;
      } else if (note.dirty) {
        await api.updateNote(note.id, { content: note.content });
        note.dirty = false;
      }
    } catch {
      /* keep local */
    }
  }
  await saveNotes(state);
}

export function renderNotesPage({ toast, confirmDelete, openSheet, closeSheet }) {
  const page = el("div", { class: "notes-page" });
  const thread = el("div", { class: "notes-thread" });
  const input = el("textarea", {
    class: "notes-input",
    rows: "1",
    placeholder: "写一条便签，回车发送",
  });
  const sendBtn = el("button", { class: "btn primary icon", type: "button", title: "发送" }, icon("send"));

  async function reload() {
    const state = await refreshNotesFromBackend();
    renderThread(state.notes);
  }

  function renderThread(notes) {
    if (!notes.length) {
      thread.replaceChildren(el("div", { class: "notes-empty" }, "还没有便签，在下方输入后发送。"));
      return;
    }
    thread.replaceChildren(
      ...notes.map((note) => {
        const bubble = el(
          "article",
          { class: "note-bubble" },
          el("div", { class: "note-text" }, note.content),
          el(
            "div",
            { class: "note-meta" },
            el("span", {}, formatDateTime(note.updatedAt || note.createdAt)),
            el(
              "div",
              { class: "note-actions" },
              el("button", { class: "btn ghost icon", type: "button", title: "编辑", onClick: () => openEdit(note) }, icon("pencil")),
              el("button", { class: "btn ghost icon", type: "button", title: "删除", onClick: () => removeNote(note) }, icon("trash"))
            )
          )
        );
        return bubble;
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
                await updateNote(note.id, editor.value);
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

  async function removeNote(note) {
    const ok = await confirmDelete(`确定删除这条便签吗？此操作不可恢复。`);
    if (!ok) return;
    await deleteNote(note.id);
    await reload();
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
    renderAnalysisBar({ toast, openSheet, closeSheet }),
    thread,
    el("div", { class: "notes-composer" }, input, sendBtn)
  );
  reload();
  queueMicrotask(() => input.focus());
  return page;
}
