import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeDirtyWithRemote, pushDirtyRecords, withBackend } from "../js/persist.js";
import { installChrome } from "./helpers.js";

test("mergeDirtyWithRemote keeps local leftovers and dirty remote rows", () => {
  const local = [
    { id: "uuid-1", content: "本地未同步", dirty: true },
    { id: "2", content: "本地改过", dirty: true },
    { id: "3", content: "干净", dirty: false },
  ];
  const remote = [
    { id: "2", content: "服务端旧值", dirty: false },
    { id: "3", content: "服务端新值", dirty: false },
    { id: "4", content: "仅远端", dirty: false },
  ];
  const merged = mergeDirtyWithRemote(local, remote);
  assert.equal(merged.length, 4);
  assert.equal(merged[0].id, "uuid-1");
  assert.equal(merged.find((item) => item.id === "2").content, "本地改过");
  assert.equal(merged.find((item) => item.id === "3").content, "服务端新值");
  assert.ok(merged.some((item) => item.id === "4"));
});

test("withBackend returns value, true for void, undefined on error", async () => {
  installChrome();
  assert.equal(await withBackend("fail", async () => 42), 42);
  assert.equal(await withBackend("fail", async () => {}), true);
  assert.equal(
    await withBackend("fail", async () => {
      throw new Error("boom");
    }),
    undefined
  );
});

test("pushDirtyRecords creates leftovers and updates dirty remotes", async () => {
  const items = [
    { id: "uuid-1", content: "本地", dirty: true },
    { id: "2", content: "已改", dirty: true },
    { id: "3", content: "干净", dirty: false },
  ];
  const created = [];
  const updated = [];
  await pushDirtyRecords(items, {
    create: async (item) => {
      created.push(item.content);
      return { id: 9 };
    },
    update: async (item) => {
      updated.push(item.id);
    },
  });
  assert.deepEqual(created, ["本地"]);
  assert.deepEqual(updated, ["2"]);
  assert.equal(items[0].id, "9");
  assert.equal(items[0].dirty, false);
  assert.equal(items[1].dirty, false);
  assert.equal(items[2].dirty, false);
});

test("pushDirtyRecords keeps local when remote throws", async () => {
  const items = [{ id: "uuid-1", content: "本地", dirty: true }];
  await pushDirtyRecords(items, {
    create: async () => {
      throw new Error("down");
    },
    update: async () => {},
  });
  assert.equal(items[0].id, "uuid-1");
  assert.equal(items[0].dirty, true);
});
