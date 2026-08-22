import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeDirtyWithRemote } from "../js/persist.js";

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
