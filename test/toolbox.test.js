import assert from "node:assert/strict";
import { test } from "node:test";
import { addToToolbox, findToolboxItemByUrl } from "../js/toolbox.js";
import { TOOLBOX_KEY } from "../js/settings.js";
import { installOfflineExtension } from "./helpers.js";

test("findToolboxItemByUrl ignores hash", () => {
  const items = [{ id: "1", url: "https://www.feishu.cn/docs#x" }];
  assert.equal(findToolboxItemByUrl(items, "https://www.feishu.cn/docs").id, "1");
  assert.equal(findToolboxItemByUrl(items, "https://other.com"), null);
});

test("addToToolbox stores locally and detects duplicates", async () => {
  const env = installOfflineExtension();
  try {
    const first = await addToToolbox({ title: "飞书", url: "https://www.feishu.cn" });
    assert.equal(first.duplicated, false);
    assert.equal(first.item.title, "飞书");
    const second = await addToToolbox({ title: "飞书文档", url: "https://www.feishu.cn/#x" });
    assert.equal(second.duplicated, true);
    assert.equal(env.local.get(TOOLBOX_KEY).items.length, 1);
  } finally {
    env.restoreFetch();
  }
});

test("addToToolbox rejects missing url", async () => {
  installOfflineExtension();
  await assert.rejects(() => addToToolbox({ title: "x" }), /没有可加入的网页/);
});
