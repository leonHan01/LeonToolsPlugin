import assert from "node:assert/strict";
import { test } from "node:test";
import { createNote, deleteNote, updateNote } from "../js/notes.js";
import { NOTES_KEY } from "../js/settings.js";
import { installOfflineExtension } from "./helpers.js";

test("createNote rejects blank content", async () => {
  await assert.rejects(() => createNote("  "), /便签内容不能为空/);
});

test("create update and delete note locally", async () => {
  const env = installOfflineExtension();
  try {
    const note = await createNote("一条便签");
    assert.equal(note.content, "一条便签");
    assert.equal(note.dirty, true);
    const updated = await updateNote(note.id, "改过了");
    assert.equal(updated.content, "改过了");
    await deleteNote(note.id);
    assert.deepEqual(env.local.get(NOTES_KEY).notes, []);
  } finally {
    env.restoreFetch();
  }
});

test("updateNote rejects missing id", async () => {
  installOfflineExtension();
  await assert.rejects(() => updateNote("missing", "x"), /便签不存在/);
});
