import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_API_BASE,
  getApiBase,
  getStorageMode,
  loadUi,
  queueDelete,
  saveUi,
  STORAGE_MODE_BACKEND,
  STORAGE_MODE_BROWSER,
} from "../js/settings.js";
import { installChrome, installOfflineExtension } from "./helpers.js";

test("loadUi fills defaults", async () => {
  installChrome();
  const ui = await loadUi();
  assert.equal(ui.apiBase, DEFAULT_API_BASE);
  assert.equal(ui.storageMode, STORAGE_MODE_BACKEND);
  assert.equal(ui.lastTab, "collections");
});

test("saveUi merges and getStorageMode recognizes browser", async () => {
  installChrome();
  await saveUi({ storageMode: STORAGE_MODE_BROWSER, apiBase: "http://127.0.0.1:8080/" });
  assert.equal(await getStorageMode(), STORAGE_MODE_BROWSER);
  assert.equal(await getApiBase(), "http://127.0.0.1:8080");
  assert.equal((await loadUi()).storageMode, STORAGE_MODE_BROWSER);
});

test("queueDelete appends pending ops", async () => {
  installOfflineExtension();
  await queueDelete({ kind: "item", itemId: "1" });
  const meta = await queueDelete({ kind: "group", groupId: "2" });
  assert.equal(meta.pendingDeletes.length, 2);
  assert.equal(meta.pendingDeletes[1].kind, "group");
});
