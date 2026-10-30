import assert from "node:assert/strict";
import { test } from "node:test";
import { ensureTldr, snapshotPrompt } from "../js/work-analysis.js";

test("snapshotPrompt splits notes and todo states", () => {
  const text = snapshotPrompt(
    [{ content: "会议纪要" }],
    [
      { content: "写测试", done: false },
      { content: "发飞书", done: true },
    ]
  );
  assert.match(text, /【便签】/);
  assert.match(text, /会议纪要/);
  assert.match(text, /【未完成待办】/);
  assert.match(text, /写测试/);
  assert.match(text, /【已完成待办】/);
  assert.match(text, /发飞书/);
  assert.match(text, /TL;DR/);
});

test("snapshotPrompt has empty placeholders", () => {
  const text = snapshotPrompt([], []);
  assert.match(text, /暂无便签/);
  assert.match(text, /没有未完成待办/);
  assert.match(text, /没有已完成待办/);
});

test("snapshotPrompt omits archived notes", () => {
  const text = snapshotPrompt(
    [
      { content: "进行中", archived: false },
      { content: "旧记录", archived: true },
    ],
    []
  );
  assert.match(text, /进行中/);
  assert.doesNotMatch(text, /旧记录/);
});

test("snapshotPrompt treats only-archived notes as empty", () => {
  const text = snapshotPrompt([{ content: "旧记录", archived: true }], []);
  assert.match(text, /暂无便签/);
  assert.doesNotMatch(text, /旧记录/);
});

test("ensureTldr prefixes missing summary", () => {
  const withPrefix = ensureTldr("TL;DR：先做测试\n\n详情");
  assert.equal(withPrefix.startsWith("TL;DR："), true);
  const added = ensureTldr("今天优先补覆盖率");
  assert.equal(added.startsWith("TL;DR：今天优先补覆盖率"), true);
  const english = ensureTldr("TL;DR: ship tests");
  assert.equal(english.startsWith("TL;DR："), true);
});
