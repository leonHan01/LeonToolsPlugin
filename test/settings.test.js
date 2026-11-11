import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_API_BASE,
  getApiBase,
  loadUi,
  queueDelete,
  saveUi,
} from "../js/settings.js";
import { installChrome, installOfflineExtension } from "./helpers.js";

test("loadUi fills defaults", async () => {
  installChrome();
  const ui = await loadUi();
  assert.equal(ui.apiBase, DEFAULT_API_BASE);
  assert.equal(ui.storageMode, undefined);
  assert.equal(ui.lastTab, "collections");
});

test("legacy browser mode is upgraded to backend", async () => {
  installChrome();
  await saveUi({ storageMode: "browser", apiBase: "http://127.0.0.1:8080/" });
  assert.equal(await getApiBase(), "http://127.0.0.1:8080");
  assert.equal((await loadUi()).storageMode, undefined);
});

test("queueDelete appends pending ops", async () => {
  installOfflineExtension();
  await queueDelete({ kind: "item", itemId: "1" });
  const meta = await queueDelete({ kind: "group", groupId: "2" });
  assert.equal(meta.pendingDeletes.length, 2);
  assert.equal(meta.pendingDeletes[1].kind, "group");
});


test("only the existing public backend and its session token migrate from 8080 to 443", async () => {
  const { getApiToken, saveApiToken } = await import("../js/settings.js");
  installChrome({ local: { "myWorkflow.ui": { apiBase: "https://121.40.254.112:8080/" } } });
  await saveApiToken("https://121.40.254.112:8080", "test-token");
  assert.equal(await getApiBase(), "https://121.40.254.112");
  assert.equal((await loadUi()).apiBase, "https://121.40.254.112");
  assert.equal(await getApiToken(await getApiBase()), "test-token");
  assert.equal(await getApiToken("https://another.example"), "");
  await saveUi({ apiBase: "http://127.0.0.1:8080" });
  assert.equal(await getApiBase(), "http://127.0.0.1:8080");
  assert.equal(await getApiToken(await getApiBase()), "");
  await saveUi({ apiBase: "https://other.example:8080" });
  assert.equal(await getApiBase(), "https://other.example:8080");
});
