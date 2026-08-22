import * as api from "./api.js";
import { PENDING_KEY, STORAGE_KEY, STORAGE_MODE_BACKEND, getStorageMode, loadUi, queueDelete, saveUi } from "./settings.js";

export { loadUi, saveUi };
export { isRemoteId } from "./api.js";

const COLORS = ["#2563eb", "#7c3aed", "#db2777", "#ea580c", "#059669", "#0284c7", "#4f46e5"];

export function uid() {
  return crypto.randomUUID();
}

export function now() {
  return Date.now();
}

export function sameId(left, right) {
  return String(left) === String(right);
}

export function emptyGroup(name = "默认分组") {
  return { id: uid(), name, items: [], dirty: true, sortOrder: 0 };
}

export function emptyCollection({ name, description = "", color, icon = "" } = {}) {
  const ts = now();
  return {
    id: uid(),
    name: name.trim(),
    description: (description || "").trim(),
    icon: icon || "",
    color: color || COLORS[Math.floor(Math.random() * COLORS.length)],
    createdAt: ts,
    updatedAt: ts,
    dirty: true,
    sortOrder: 0,
    groups: [emptyGroup()],
  };
}

export function emptyState() {
  return { collections: [] };
}

export async function loadState() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const state = data[STORAGE_KEY];
  if (!state || !Array.isArray(state.collections)) return emptyState();
  return state;
}

export async function saveState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

export async function readPendingAdd() {
  const data = await chrome.storage.session.get(PENDING_KEY);
  return data[PENDING_KEY] || null;
}

export async function clearPendingAdd() {
  await chrome.storage.session.remove(PENDING_KEY);
}

export async function withState(mutator) {
  const state = await loadState();
  const result = await mutator(state);
  await saveState(state);
  return result === undefined ? state : result;
}

export function findCollection(state, collectionId) {
  return state.collections.find((item) => sameId(item.id, collectionId)) || null;
}

export function findGroup(collection, groupId) {
  if (!collection) return null;
  return collection.groups.find((item) => sameId(item.id, groupId)) || collection.groups[0] || null;
}

export function collectionItemCount(collection) {
  return collection.groups.reduce((sum, group) => sum + group.items.length, 0);
}

export function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    let href = parsed.toString();
    if (href.endsWith("/") && parsed.pathname !== "/") href = href.slice(0, -1);
    return href;
  } catch {
    return String(url || "");
  }
}

export function findItemByUrl(state, url, collectionId) {
  const target = normalizeUrl(url);
  const collections = collectionId
    ? state.collections.filter((item) => sameId(item.id, collectionId))
    : state.collections;
  for (const collection of collections) {
    for (const group of collection.groups) {
      const item = group.items.find((entry) => normalizeUrl(entry.url) === target);
      if (item) return { collection, group, item };
    }
  }
  return null;
}

export function colorFromId(id) {
  const text = String(id);
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  return COLORS[hash % COLORS.length];
}

export function fromRemoteItem(item, favIconUrl = "") {
  return {
    id: String(item.id),
    title: item.name || item.title || item.url,
    url: item.url,
    note: item.note || "",
    favIconUrl: favIconUrl || "",
    addedAt: api.parseTime(item.createTime),
    sortOrder: item.sortOrder ?? 0,
    dirty: false,
  };
}

export function fromRemoteCollection(remote, extras = {}) {
  const colors = extras.colors || {};
  const favicons = extras.favicons || {};
  return {
    id: String(remote.id),
    name: remote.name,
    description: remote.description || "",
    icon: remote.icon || extras.icon || "",
    color: extras.color || colors[String(remote.id)] || colors[remote.name] || colorFromId(remote.id),
    createdAt: api.parseTime(remote.createTime),
    updatedAt: api.parseTime(remote.updateTime),
    sortOrder: remote.sortOrder ?? 0,
    dirty: false,
    groups: (remote.groups || []).map((group, groupIndex) => ({
      id: String(group.id),
      name: group.name,
      dirty: false,
      sortOrder: group.sortOrder ?? groupIndex,
      items: (group.items || []).map((item) =>
        fromRemoteItem(item, favicons[normalizeUrl(item.url)] || extras.favIconUrl || "")
      ),
    })),
  };
}

export async function createCollection(fields) {
  if (await api.shouldUseBackend()) {
    try {
      const remote = await api.createCollection({
        name: api.clip(fields.name, 200),
        description: fields.description || "",
        icon: fields.icon || "",
      });
      const collection = fromRemoteCollection(remote, { color: fields.color, icon: fields.icon || "" });
      await withState((state) => {
        state.collections.unshift(collection);
        reindex(state.collections);
        return collection;
      });
      await api.markAvailability(true);
      return collection;
    } catch (error) {
      await api.markAvailability(false, error instanceof Error ? error.message : "保存到后端失败");
    }
  }
  const collection = emptyCollection(fields);
  return withState((state) => {
    state.collections.unshift(collection);
    reindex(state.collections);
    return collection;
  });
}

export async function updateCollection(collectionId, patch) {
  const updated = await withState((state) => {
    const collection = findCollection(state, collectionId);
    if (!collection) throw new Error("集合不存在");
    if (patch.name != null) collection.name = patch.name.trim();
    if (patch.description != null) collection.description = patch.description.trim();
    if (patch.icon != null) collection.icon = String(patch.icon || "").trim();
    if (patch.color) collection.color = patch.color;
    collection.updatedAt = now();
    collection.dirty = true;
    return collection;
  });
  if (api.isRemoteId(collectionId) && (await api.shouldUseBackend())) {
    try {
      await api.updateCollection(collectionId, {
        name: api.clip(updated.name, 200),
        description: updated.description || "",
        icon: updated.icon || "",
      });
      await withState((state) => {
        const collection = findCollection(state, collectionId);
        if (collection) collection.dirty = false;
      });
      await api.markAvailability(true);
    } catch (error) {
      await api.markAvailability(false, error instanceof Error ? error.message : "更新后端失败");
    }
  }
  return updated;
}

export async function deleteCollection(collectionId) {
  await withState((state) => {
    state.collections = state.collections.filter((item) => !sameId(item.id, collectionId));
  });
  if (!api.isRemoteId(collectionId)) return;
  if (await api.shouldUseBackend()) {
    try {
      await api.deleteCollection(collectionId);
      await api.markAvailability(true);
      return;
    } catch (error) {
      await api.markAvailability(false, error instanceof Error ? error.message : "删除后端失败");
    }
  }
  if ((await getStorageMode()) === STORAGE_MODE_BACKEND) {
    await queueDelete({ kind: "collection", collectionId: String(collectionId) });
  }
}

export async function createGroup(collectionId, name) {
  const groupName = (name || "").trim() || "未命名分组";
  if (api.isRemoteId(collectionId) && (await api.shouldUseBackend())) {
    try {
      const remote = await api.createGroup(collectionId, { name: api.clip(groupName, 120) });
      const group = { id: String(remote.id), name: remote.name, items: [], dirty: false };
      await withState((state) => {
        const collection = findCollection(state, collectionId);
        if (!collection) throw new Error("集合不存在");
        collection.groups.push(group);
        reindex(collection.groups);
        collection.updatedAt = now();
        return group;
      });
      await api.markAvailability(true);
      return group;
    } catch (error) {
      await api.markAvailability(false, error instanceof Error ? error.message : "创建分组失败");
    }
  }
  return withState((state) => {
    const collection = findCollection(state, collectionId);
    if (!collection) throw new Error("集合不存在");
    const group = emptyGroup(groupName);
    collection.groups.push(group);
    reindex(collection.groups);
    collection.updatedAt = now();
    collection.dirty = true;
    return group;
  });
}

export async function renameGroup(collectionId, groupId, name) {
  const groupName = (name || "").trim();
  const group = await withState((state) => {
    const collection = findCollection(state, collectionId);
    const current = findGroup(collection, groupId);
    if (!current) throw new Error("分组不存在");
    current.name = groupName || current.name;
    current.dirty = true;
    collection.updatedAt = now();
    return current;
  });
  if (api.isRemoteId(collectionId) && api.isRemoteId(groupId) && (await api.shouldUseBackend())) {
    try {
      await api.updateGroup(collectionId, groupId, { name: api.clip(group.name, 120) });
      await withState((state) => {
        const current = findGroup(findCollection(state, collectionId), groupId);
        if (current) current.dirty = false;
      });
      await api.markAvailability(true);
    } catch (error) {
      await api.markAvailability(false, error instanceof Error ? error.message : "更新分组失败");
    }
  }
  return group;
}

export async function deleteGroup(collectionId, groupId) {
  await withState((state) => {
    const collection = findCollection(state, collectionId);
    if (!collection) throw new Error("集合不存在");
    if (collection.groups.length <= 1) throw new Error("至少保留一个分组");
    collection.groups = collection.groups.filter((item) => !sameId(item.id, groupId));
    collection.updatedAt = now();
  });
  if (!api.isRemoteId(collectionId) || !api.isRemoteId(groupId)) return;
  if (await api.shouldUseBackend()) {
    try {
      await api.deleteGroup(collectionId, groupId);
      await api.markAvailability(true);
      return;
    } catch (error) {
      await api.markAvailability(false, error instanceof Error ? error.message : "删除分组失败");
    }
  }
  if ((await getStorageMode()) === STORAGE_MODE_BACKEND) {
    await queueDelete({ kind: "group", collectionId: String(collectionId), groupId: String(groupId) });
  }
}

export function buildPageItem({ title, url, favIconUrl = "", note = "" }) {
  return {
    id: uid(),
    title: (title || hostnameOf(url) || url).trim(),
    url: url.trim(),
    favIconUrl: favIconUrl || "",
    note: (note || "").trim(),
    addedAt: now(),
    sortOrder: 0,
    dirty: true,
  };
}

export async function addPageToCollection(collectionId, groupId, page) {
  const snapshot = await loadState();
  const existing = findItemByUrl(snapshot, page.url, collectionId);
  if (existing) return { collection: existing.collection, group: existing.group, item: existing.item, duplicated: true };

  if (api.isRemoteId(collectionId) && api.isRemoteId(groupId) && (await api.shouldUseBackend())) {
    try {
      const remote = await api.createItem(collectionId, {
        groupId: Number(groupId),
        name: api.clip(page.title || hostnameOf(page.url) || page.url, 200),
        url: page.url,
        note: page.note || "",
      });
      const item = fromRemoteItem(remote, page.favIconUrl || "");
      const result = await withState((state) => {
        const collection = findCollection(state, collectionId);
        const group = findGroup(collection, groupId);
        if (!collection || !group) throw new Error("集合或分组不存在");
        group.items.unshift(item);
        reindex(group.items);
        collection.updatedAt = now();
        return { collection, group, item, duplicated: false };
      });
      await api.markAvailability(true);
      return result;
    } catch (error) {
      await api.markAvailability(false, error instanceof Error ? error.message : "加入后端失败");
    }
  }

  return withState((state) => {
    const collection = findCollection(state, collectionId);
    if (!collection) throw new Error("集合不存在");
    const group = findGroup(collection, groupId);
    if (!group) throw new Error("分组不存在");
    const item = buildPageItem(page);
    group.items.unshift(item);
    reindex(group.items);
    collection.updatedAt = now();
    collection.dirty = true;
    return { collection, group, item, duplicated: false };
  });
}

export async function updateItem(collectionId, itemId, patch) {
  const item = await withState((state) => {
    const located = locateItem(state, collectionId, itemId);
    if (!located) throw new Error("网页不存在");
    const { collection, item: current } = located;
    if (patch.title != null) current.title = patch.title.trim() || current.title;
    if (patch.url != null) current.url = patch.url.trim();
    if (patch.note != null) current.note = patch.note.trim();
    if (patch.groupId && !sameId(patch.groupId, located.group.id)) {
      const target = findGroup(collection, patch.groupId);
      if (!target) throw new Error("分组不存在");
      located.group.items = located.group.items.filter((entry) => !sameId(entry.id, itemId));
      target.items.unshift(current);
    }
    current.dirty = true;
    collection.updatedAt = now();
    return current;
  });
  const latest = await loadState();
  const located = locateItem(latest, collectionId, itemId);
  const remoteGroupId = located?.group.id;
  if (api.isRemoteId(collectionId) && api.isRemoteId(itemId) && api.isRemoteId(remoteGroupId) && (await api.shouldUseBackend())) {
    try {
      await api.updateItem(collectionId, itemId, {
        groupId: Number(remoteGroupId),
        name: api.clip(item.title, 200),
        url: item.url,
        note: item.note || "",
      });
      await withState((state) => {
        const current = locateItem(state, collectionId, itemId);
        if (current) current.item.dirty = false;
      });
      await api.markAvailability(true);
    } catch (error) {
      await api.markAvailability(false, error instanceof Error ? error.message : "更新网页失败");
    }
  }
  return item;
}

export async function deleteItem(collectionId, itemId) {
  await withState((state) => {
    const located = locateItem(state, collectionId, itemId);
    if (!located) return;
    located.group.items = located.group.items.filter((entry) => !sameId(entry.id, itemId));
    located.collection.updatedAt = now();
  });
  if (!api.isRemoteId(collectionId) || !api.isRemoteId(itemId)) return;
  if (await api.shouldUseBackend()) {
    try {
      await api.deleteItem(collectionId, itemId);
      await api.markAvailability(true);
      return;
    } catch (error) {
      await api.markAvailability(false, error instanceof Error ? error.message : "删除网页失败");
    }
  }
  if ((await getStorageMode()) === STORAGE_MODE_BACKEND) {
    await queueDelete({ kind: "item", collectionId: String(collectionId), itemId: String(itemId) });
  }
}

export function locateItem(state, collectionId, itemId) {
  const collection = findCollection(state, collectionId);
  if (!collection) return null;
  for (const group of collection.groups) {
    const item = group.items.find((entry) => sameId(entry.id, itemId));
    if (item) return { collection, group, item };
  }
  return null;
}

export function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function formatDateTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function sortedCollections(state) {
  return [...state.collections].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

export function moveById(items, draggedId, targetId) {
  const next = [...items];
  const from = next.findIndex((item) => sameId(item.id, draggedId));
  const to = next.findIndex((item) => sameId(item.id, targetId));
  if (from < 0 || to < 0 || from === to) return items;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function reindex(items) {
  items.forEach((item, index) => {
    item.sortOrder = index;
  });
  return items;
}

export async function reorderCollections(draggedId, targetId) {
  const ordered = await withState((state) => {
    state.collections = reindex(moveById(sortedCollections(state), draggedId, targetId));
    return state.collections;
  });
  await persistRemoteOrder(
    () => api.reorderCollections(ordered.map((item) => item.id).filter((id) => api.isRemoteId(id)))
  );
  return ordered;
}

export async function reorderGroups(collectionId, draggedId, targetId) {
  const groupIds = await withState((state) => {
    const collection = findCollection(state, collectionId);
    if (!collection) throw new Error("集合不存在");
    collection.groups = reindex(moveById(collection.groups, draggedId, targetId));
    collection.updatedAt = now();
    return collection.groups.map((group) => group.id);
  });
  if (api.isRemoteId(collectionId)) {
    await persistRemoteOrder(() =>
      api.reorderGroups(
        collectionId,
        groupIds.filter((id) => api.isRemoteId(id))
      )
    );
  }
}

export async function reorderItems(collectionId, groupId, draggedId, targetId) {
  const itemIds = await withState((state) => {
    const collection = findCollection(state, collectionId);
    const group = findGroup(collection, groupId);
    if (!collection || !group) throw new Error("分组不存在");
    group.items = reindex(moveById(group.items, draggedId, targetId));
    collection.updatedAt = now();
    return group.items.map((item) => item.id);
  });
  if (api.isRemoteId(collectionId) && api.isRemoteId(groupId)) {
    await persistRemoteOrder(() =>
      api.reorderItems(
        collectionId,
        groupId,
        itemIds.filter((id) => api.isRemoteId(id))
      )
    );
  }
}

async function persistRemoteOrder(send) {
  if (!(await api.shouldUseBackend())) return;
  try {
    await send();
    await api.markAvailability(true);
  } catch (error) {
    await api.markAvailability(false, error instanceof Error ? error.message : "保存排序失败");
  }
}

export async function exportJson() {
  const state = await loadState();
  return JSON.stringify(
    {
      version: 1,
      exportedAt: now(),
      collections: state.collections,
    },
    null,
    2
  );
}

export async function importJson(text) {
  const parsed = JSON.parse(text);
  const incoming = Array.isArray(parsed) ? parsed : parsed.collections;
  if (!Array.isArray(incoming)) throw new Error("文件格式不正确");
  const count = await withState((state) => {
    const mapped = incoming.map((collection) => remapCollection(collection));
    state.collections = reindex([...mapped, ...state.collections]);
    return mapped.length;
  });
  return count;
}

function remapCollection(raw) {
  const groups =
    Array.isArray(raw.groups) && raw.groups.length
      ? raw.groups.map((group, groupIndex) => ({
          id: uid(),
          name: group.name || "默认分组",
          dirty: true,
          sortOrder: group.sortOrder ?? groupIndex,
          items: Array.isArray(group.items)
            ? group.items
                .filter((item) => item && item.url)
                .map((item, itemIndex) => ({
                  id: uid(),
                  title: item.title || item.name || item.url,
                  url: item.url,
                  favIconUrl: item.favIconUrl || "",
                  note: item.note || "",
                  addedAt: item.addedAt || now(),
                  sortOrder: item.sortOrder ?? itemIndex,
                  dirty: true,
                }))
            : [],
        }))
      : [emptyGroup()];

  return {
    id: uid(),
    name: raw.name || "导入的集合",
    description: raw.description || "",
    color: raw.color || COLORS[0],
    createdAt: now(),
    updatedAt: now(),
    dirty: true,
    sortOrder: raw.sortOrder ?? 0,
    groups,
  };
}
