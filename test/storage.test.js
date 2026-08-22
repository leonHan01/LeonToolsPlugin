import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collectionItemCount,
  emptyCollection,
  fromRemoteCollection,
  hostnameOf,
  normalizeUrl,
  sameId,
} from "../js/storage.js";

test("normalizeUrl strips hash and trailing slash", () => {
  assert.equal(normalizeUrl("https://example.com/path/?q=1#x"), "https://example.com/path/?q=1");
  assert.equal(normalizeUrl("https://example.com/"), "https://example.com/");
  assert.equal(normalizeUrl("not a url"), "not a url");
});

test("hostnameOf drops www", () => {
  assert.equal(hostnameOf("https://www.feishu.cn/docs"), "feishu.cn");
  assert.equal(hostnameOf("bad"), "");
});

test("emptyCollection keeps icon and default group", () => {
  const collection = emptyCollection({ name: "科技", description: "资讯", icon: "newspaper" });
  assert.equal(collection.name, "科技");
  assert.equal(collection.icon, "newspaper");
  assert.equal(collection.groups.length, 1);
  assert.equal(collectionItemCount(collection), 0);
});

test("fromRemoteCollection maps icon and groups", () => {
  const mapped = fromRemoteCollection({
    id: 3,
    name: "置顶",
    description: "",
    icon: "star",
    sortOrder: 0,
    createTime: "2026-08-22T10:00:00",
    updateTime: "2026-08-22T11:00:00",
    groups: [{ id: 1, name: "默认分组", items: [{ id: 9, name: "飞书", url: "https://www.feishu.cn" }] }],
  });
  assert.equal(mapped.icon, "star");
  assert.equal(mapped.groups[0].items[0].title, "飞书");
  assert.equal(collectionItemCount(mapped), 1);
  assert.equal(sameId(mapped.id, "3"), true);
});
