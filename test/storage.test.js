import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addPageToCollection,
  buildPageItem,
  collectionItemCount,
  colorFromId,
  createCollection,
  createGroup,
  emptyCollection,
  findCollection,
  findGroup,
  findItemByUrl,
  fromRemoteCollection,
  matchSavedCard,
  fromRemoteItem,
  hostnameOf,
  importJson,
  locateItem,
  moveById,
  moveItem,
  normalizeUrl,
  reindex,
  sameId,
  sortedCollections,
} from "../js/storage.js";
import { STORAGE_KEY } from "../js/settings.js";
import { installOfflineExtension } from "./helpers.js";

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

test("fromRemoteItem falls back to url title", () => {
  const item = fromRemoteItem({ id: 1, url: "https://a.com/x" });
  assert.equal(item.title, "https://a.com/x");
  assert.equal(item.dirty, false);
});

test("moveById reorders and reindex writes sortOrder", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const moved = moveById(items, "c", "a");
  assert.deepEqual(moved.map((item) => item.id), ["c", "a", "b"]);
  assert.equal(moveById(items, "missing", "a"), items);
  assert.equal(moveById(items, "a", "a"), items);
  reindex(moved);
  assert.deepEqual(moved.map((item) => item.sortOrder), [0, 1, 2]);
});

test("findCollection findGroup locateItem and findItemByUrl", () => {
  const state = {
    collections: [
      fromRemoteCollection({
        id: 1,
        name: "置顶",
        groups: [{ id: 2, name: "默认", items: [{ id: 3, name: "飞书", url: "https://www.feishu.cn/docs#x" }] }],
      }),
    ],
  };
  assert.equal(findCollection(state, 1).name, "置顶");
  assert.equal(findCollection(state, 9), null);
  assert.equal(findGroup(findCollection(state, 1), 2).name, "默认");
  assert.equal(findGroup(findCollection(state, 1), 99).name, "默认");
  assert.equal(locateItem(state, 1, 3).item.title, "飞书");
  assert.equal(locateItem(state, 1, 99), null);
  assert.equal(findItemByUrl(state, "https://www.feishu.cn/docs").item.title, "飞书");
  assert.equal(findItemByUrl(state, "https://other.com"), null);
});

test("matchSavedCard prefers collection then toolbox", () => {
  const collections = [
    fromRemoteCollection({
      id: 1,
      name: "置顶",
      groups: [{ id: 2, name: "默认", items: [{ id: 3, name: "飞书", url: "https://www.feishu.cn/docs#x" }] }],
    }),
  ];
  const toolbox = [
    { id: "9", url: "https://www.feishu.cn/docs" },
    { id: "8", url: "https://github.com/" },
  ];
  const inBoth = matchSavedCard("https://www.feishu.cn/docs", collections, toolbox);
  assert.equal(inBoth.kind, "collection");
  assert.equal(String(inBoth.collectionId), "1");
  assert.equal(String(inBoth.itemId), "3");
  const onlyTool = matchSavedCard("https://github.com", collections, toolbox);
  assert.equal(onlyTool.kind, "toolbox");
  assert.equal(String(onlyTool.itemId), "8");
  assert.equal(matchSavedCard("https://other.com", collections, toolbox), null);
  assert.equal(matchSavedCard("", collections, toolbox), null);
});

test("colorFromId is stable and sortedCollections uses sortOrder", () => {
  assert.equal(colorFromId(3), colorFromId("3"));
  const state = {
    collections: [
      { id: "b", sortOrder: 2 },
      { id: "a", sortOrder: 0 },
    ],
  };
  assert.deepEqual(sortedCollections(state).map((item) => item.id), ["a", "b"]);
});

test("buildPageItem uses hostname when title missing", () => {
  const item = buildPageItem({ url: "https://www.example.com/path", note: "备注" });
  assert.equal(item.title, "example.com");
  assert.equal(item.note, "备注");
  assert.equal(item.dirty, true);
});

test("createCollection and duplicate page stay local in browser mode", async () => {
  const env = installOfflineExtension();
  try {
    const collection = await createCollection({ name: "科技", icon: "rocket" });
    assert.equal(collection.name, "科技");
    assert.equal(collection.icon, "rocket");
    const first = await addPageToCollection(collection.id, collection.groups[0].id, {
      title: "飞书",
      url: "https://www.feishu.cn/docs",
    });
    assert.equal(first.duplicated, false);
    const second = await addPageToCollection(collection.id, collection.groups[0].id, {
      title: "飞书文档",
      url: "https://www.feishu.cn/docs#hash",
    });
    assert.equal(second.duplicated, true);
    assert.equal(env.local.get(STORAGE_KEY).collections.length, 1);
  } finally {
    env.restoreFetch();
  }
});

test("importJson remaps ids and prepends collections", async () => {
  const env = installOfflineExtension();
  try {
    const count = await importJson(
      JSON.stringify({
        collections: [
          {
            name: "导入",
            icon: "star",
            groups: [{ name: "默认", items: [{ title: "飞书", url: "https://www.feishu.cn" }] }],
          },
        ],
      })
    );
    assert.equal(count, 1);
    const imported = env.local.get(STORAGE_KEY).collections[0];
    assert.equal(imported.name, "导入");
    assert.equal(imported.icon, "star");
    assert.equal(imported.dirty, true);
    assert.equal(imported.groups[0].items[0].url, "https://www.feishu.cn");
  } finally {
    env.restoreFetch();
  }
});

test("moveItem relocates a page across groups", async () => {
  const env = installOfflineExtension();
  try {
    const collection = await createCollection({ name: "科技" });
    const homeId = collection.groups[0].id;
    const docs = await createGroup(collection.id, "文档");
    const feishu = await addPageToCollection(collection.id, homeId, {
      title: "飞书",
      url: "https://www.feishu.cn",
    });
    const github = await addPageToCollection(collection.id, homeId, {
      title: "GitHub",
      url: "https://github.com",
    });

    await moveItem(collection.id, feishu.item.id, docs.id);
    let saved = env.local.get(STORAGE_KEY).collections[0];
    assert.deepEqual(
      saved.groups.find((group) => group.id === homeId).items.map((item) => item.title),
      ["GitHub"]
    );
    assert.deepEqual(
      saved.groups.find((group) => group.id === docs.id).items.map((item) => item.title),
      ["飞书"]
    );

    await moveItem(collection.id, github.item.id, docs.id, feishu.item.id);
    saved = env.local.get(STORAGE_KEY).collections[0];
    assert.deepEqual(
      saved.groups.find((group) => group.id === homeId).items.map((item) => item.title),
      []
    );
    assert.deepEqual(
      saved.groups.find((group) => group.id === docs.id).items.map((item) => item.title),
      ["GitHub", "飞书"]
    );
    assert.deepEqual(
      saved.groups.find((group) => group.id === docs.id).items.map((item) => item.sortOrder),
      [0, 1]
    );
  } finally {
    env.restoreFetch();
  }
});

test("moveItem reorders within the same group", async () => {
  const env = installOfflineExtension();
  try {
    const collection = await createCollection({ name: "科技" });
    const groupId = collection.groups[0].id;
    const a = await addPageToCollection(collection.id, groupId, { title: "A", url: "https://a.example" });
    await addPageToCollection(collection.id, groupId, { title: "B", url: "https://b.example" });
    const c = await addPageToCollection(collection.id, groupId, { title: "C", url: "https://c.example" });
    await moveItem(collection.id, a.item.id, groupId, c.item.id);
    const items = env.local.get(STORAGE_KEY).collections[0].groups[0].items;
    assert.deepEqual(items.map((item) => item.title), ["A", "C", "B"]);
  } finally {
    env.restoreFetch();
  }
});

test("moveItem rejects missing page", async () => {
  const env = installOfflineExtension();
  try {
    const collection = await createCollection({ name: "科技" });
    await assert.rejects(() => moveItem(collection.id, "missing", collection.groups[0].id), /网页不存在/);
  } finally {
    env.restoreFetch();
  }
});
