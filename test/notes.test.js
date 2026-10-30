import assert from "node:assert/strict";
import { test } from "node:test";
import { createNote, deleteNote, updateNote } from "../js/notes.js";
import { NOTES_KEY } from "../js/settings.js";
import { installBackendExtension, installOfflineExtension } from "./helpers.js";

test("createNote rejects blank content", async () => {
  await assert.rejects(() => createNote("  "), /便签内容不能为空/);
});

test("create update archive and delete note through the backend", async () => {
  const env = installBackendExtension();
  try {
    const note = await createNote("一条便签");
    assert.equal(note.content, "一条便签");
    assert.equal(note.archived, false);
    assert.equal(note.dirty, false);
    const updated = await updateNote(note.id, { content: "改过了" });
    assert.equal(updated.content, "改过了");
    assert.equal(updated.archived, false);
    await assert.rejects(() => deleteNote(note.id), /请先归档再删除便签/);
    const archived = await updateNote(note.id, { archived: true });
    assert.equal(archived.archived, true);
    assert.equal(archived.content, "改过了");
    const restored = await updateNote(note.id, { archived: false });
    assert.equal(restored.archived, false);
    await updateNote(note.id, { archived: true });
    await deleteNote(note.id);
    assert.deepEqual(env.local.get(NOTES_KEY).notes, []);
  } finally {
    env.restoreFetch();
  }
});

test("deleteNote rejects missing id", async () => {
  installOfflineExtension();
  await assert.rejects(() => deleteNote("missing"), /便签不存在/);
});

test("updateNote rejects missing id", async () => {
  installOfflineExtension();
  await assert.rejects(() => updateNote("missing", { content: "x" }), /便签不存在/);
});

test("updateNote rejects blank content", async () => {
  const env = installBackendExtension();
  try {
    const note = await createNote("一条便签");
    await assert.rejects(() => updateNote(note.id, { content: "  " }), /便签内容不能为空/);
  } finally {
    env.restoreFetch();
  }
});
