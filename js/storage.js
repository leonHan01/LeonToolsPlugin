import * as api from "./api.js";
import { PENDING_KEY, STORAGE_KEY, loadUi, saveUi } from "./settings.js";

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
    for (const group of collection.groups || []) {
      const item = (group.items || []).find((entry) => normalizeUrl(entry.url) === target);
      if (item) return { collection, group, item };
    }
  }
  return null;
}

export function matchSavedCard(url, collections = [], toolboxItems = []) {
  if (!url) return null;
  const found = findItemByUrl({ collections }, url);
  if (found) {
    return {
      kind: "collection",
      collectionId: found.collection.id,
      groupId: found.group.id,
      itemId: found.item.id,
    };
  }
  const target = normalizeUrl(url);
  const tool = toolboxItems.find((item) => item?.url && normalizeUrl(item.url) === target);
  if (tool) return { kind: "toolbox", itemId: tool.id };
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
  const remote = await api.createCollection({ name: api.clip(fields.name, 200), description: fields.description || "", icon: fields.icon || "" });
  const collection = fromRemoteCollection(remote, { color: fields.color, icon: fields.icon || "" });
  await withState((state) => { state.collections.unshift(collection); reindex(state.collections); });
  return collection;
}

export async function updateCollection(collectionId, patch) {
  const state = await loadState();
  const current = findCollection(state, collectionId);
  if (!current) throw new Error("集合不存在");
  requireRemoteId(collectionId);
  const updated = { ...current, ...patch, name: patch.name != null ? patch.name.trim() : current.name,
    description: patch.description != null ? patch.description.trim() : current.description,
    icon: patch.icon != null ? String(patch.icon || "").trim() : current.icon, updatedAt: now(), dirty: false };
  await api.updateCollection(collectionId, { name: api.clip(updated.name, 200), description: updated.description || "", icon: updated.icon || "" });
  await withState((latest) => { const index = latest.collections.findIndex((entry) => sameId(entry.id, collectionId)); if (index >= 0) latest.collections[index] = { ...latest.collections[index], ...updated, groups: latest.collections[index].groups }; });
  return updated;
}

export async function deleteCollection(collectionId) {
  requireRemoteId(collectionId);
  await api.deleteCollection(collectionId);
  await withState((state) => { state.collections = state.collections.filter((item) => !sameId(item.id, collectionId)); });
}

export async function createGroup(collectionId, name) {
  requireRemoteId(collectionId);
  const groupName = (name || "").trim() || "未命名分组";
  const remote = await api.createGroup(collectionId, { name: api.clip(groupName, 120) });
  const group = { id: String(remote.id), name: remote.name || groupName, items: [], dirty: false };
  await withState((state) => { const collection = findCollection(state, collectionId); if (collection) { collection.groups.push(group); reindex(collection.groups); collection.updatedAt = now(); } });
  return group;
}

export async function renameGroup(collectionId, groupId, name) {
  requireRemoteId(collectionId, groupId);
  const state = await loadState();
  const collection = findCollection(state, collectionId);
  const group = requireGroup(collection, groupId);
  const groupName = (name || "").trim() || group.name;
  await api.updateGroup(collectionId, groupId, { name: api.clip(groupName, 120) });
  await withState((latest) => { const current = (findCollection(latest, collectionId)?.groups || []).find((g) => sameId(g.id, groupId)); if (current) { current.name = groupName; current.dirty = false; } });
  return { ...group, name: groupName, dirty: false };
}

export async function deleteGroup(collectionId, groupId) {
  requireRemoteId(collectionId, groupId);
  const state = await loadState();
  const collection = findCollection(state, collectionId);
  if (!collection) throw new Error("集合不存在");
  requireGroup(collection, groupId);
  if (collection.groups.length <= 1) throw new Error("至少保留一个分组");
  await api.deleteGroup(collectionId, groupId);
  await withState((latest) => { const current = findCollection(latest, collectionId); if (current) current.groups = current.groups.filter((g) => !sameId(g.id, groupId)); });
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
  requireRemoteId(collectionId, groupId);
  const snapshot = await loadState();
  const existing = findItemByUrl(snapshot, page.url, collectionId);
  if (existing) return { ...existing, duplicated: true };
  const remote = await api.createItem(collectionId, { groupId: Number(groupId), name: api.clip(page.title || hostnameOf(page.url) || page.url, 200), url: page.url, note: page.note || "" });
  const item = fromRemoteItem(remote, page.favIconUrl || "");
  return withState((state) => {
    const collection = findCollection(state, collectionId);
    const group = requireGroup(collection, groupId);
    group.items.unshift(item); reindex(group.items); collection.updatedAt = now();
    return { collection, group, item, duplicated: false };
  });
}

export async function updateItem(collectionId, itemId, patch) {
  requireRemoteId(collectionId, itemId);
  const state = await loadState();
  const located = locateItem(state, collectionId, itemId);
  if (!located) throw new Error("网页不存在");
  const target = requireGroup(located.collection, patch.groupId || located.group.id);
  requireRemoteId(target.id);
  const item = { ...located.item, title: patch.title != null ? patch.title.trim() || located.item.title : located.item.title,
    url: patch.url != null ? patch.url.trim() : located.item.url, note: patch.note != null ? patch.note.trim() : located.item.note, dirty: false };
  await api.updateItem(collectionId, itemId, { groupId: Number(target.id), name: api.clip(item.title, 200), url: item.url, note: item.note || "" });
  await withState((latest) => { const found = locateItem(latest, collectionId, itemId); if (!found) return; const dest = requireGroup(found.collection, target.id); if (sameId(found.group.id, dest.id)) { const index = dest.items.findIndex((entry) => sameId(entry.id, itemId)); dest.items[index] = item; } else { found.group.items = found.group.items.filter((entry) => !sameId(entry.id, itemId)); dest.items.unshift(item); reindex(found.group.items); reindex(dest.items); } });
  return item;
}

export async function deleteItem(collectionId, itemId) {
  requireRemoteId(collectionId, itemId);
  await api.deleteItem(collectionId, itemId);
  await withState((state) => { const found = locateItem(state, collectionId, itemId); if (found) found.group.items = found.group.items.filter((entry) => !sameId(entry.id, itemId)); });
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

function requireRemoteId(...ids) {
  if (ids.some((id) => !api.isRemoteId(id))) throw new Error("旧本地数据尚未同步到后端，请先同步后再操作");
}

function requireGroup(collection, groupId) {
  const group = (collection?.groups || []).find((entry) => sameId(entry.id, groupId));
  if (!group) throw new Error("分组不存在");
  return group;
}

export async function reorderCollections(draggedId, targetId) {
  const state = await loadState();
  const ordered = reindex(moveById(sortedCollections(state), draggedId, targetId));
  requireRemoteId(...ordered.map((item) => item.id));
  await api.reorderCollections(ordered.map((item) => item.id));
  await withState((latest) => { latest.collections = ordered; });
  return ordered;
}

export async function reorderGroups(collectionId, draggedId, targetId) {
  const state = await loadState();
  const collection = findCollection(state, collectionId);
  if (!collection) throw new Error("集合不存在");
  const groups = reindex(moveById(collection.groups, draggedId, targetId));
  requireRemoteId(collectionId, ...groups.map((group) => group.id));
  await api.reorderGroups(collectionId, groups.map((group) => group.id));
  await withState((latest) => { const current = findCollection(latest, collectionId); if (current) current.groups = groups; });
}

export async function moveItem(collectionId, itemId, targetGroupId, targetItemId = null) {
  requireRemoteId(collectionId, itemId, targetGroupId);
  const state = structuredClone(await loadState());
  const found = locateItem(state, collectionId, itemId);
  if (!found) throw new Error("网页不存在");
  const target = requireGroup(found.collection, targetGroupId);
  requireRemoteId(found.group.id);
  const sameGroup = sameId(found.group.id, target.id);
  if (sameGroup && targetItemId && sameId(itemId, targetItemId)) return found.item;
  let sourceItems = found.group.items.filter((entry) => !sameId(entry.id, itemId));
  let targetItems = sameGroup && targetItemId ? moveById(found.group.items, itemId, targetItemId) : sameGroup ? sourceItems : [...target.items];
  if (!sameGroup || !targetItemId) {
    const position = targetItemId ? targetItems.findIndex((entry) => sameId(entry.id, targetItemId)) : -1;
    if (position < 0) targetItems.push(found.item); else targetItems.splice(position, 0, found.item);
  }
  reindex(sourceItems); reindex(targetItems);
  requireRemoteId(...targetItems.map((entry) => entry.id), ...sourceItems.map((entry) => entry.id));
  if (!sameGroup) await api.updateItem(collectionId, itemId, { groupId: Number(target.id), name: api.clip(found.item.title, 200), url: found.item.url, note: found.item.note || "" });
  await api.reorderItems(collectionId, target.id, targetItems.map((entry) => entry.id));
  if (!sameGroup && sourceItems.length) await api.reorderItems(collectionId, found.group.id, sourceItems.map((entry) => entry.id));
  await withState((latest) => { const current = findCollection(latest, collectionId); if (!current) return; const source = requireGroup(current, found.group.id); const dest = requireGroup(current, target.id); if (!sameGroup) source.items = sourceItems; dest.items = targetItems; });
  return found.item;
}

export async function reorderItems(collectionId, groupId, draggedId, targetId) {
  return moveItem(collectionId, draggedId, groupId, targetId);
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
  let count = 0;
  for (const raw of incoming) {
    try {
      const collection = await createCollection({ name: raw.name || "导入的集合", description: raw.description || "", icon: raw.icon || "", color: raw.color });
      const groups = Array.isArray(raw.groups) && raw.groups.length ? raw.groups : [{ name: "默认分组", items: [] }];
      for (let i = 0; i < groups.length; i += 1) {
        const source = groups[i];
        let group = i === 0 ? collection.groups[0] : await createGroup(collection.id, source.name);
        if (!group) group = await createGroup(collection.id, source.name);
        else if (i === 0 && source.name && source.name !== group.name) group = await renameGroup(collection.id, group.id, source.name);
        for (const item of source.items || []) if (item?.url) await addPageToCollection(collection.id, group.id, { title: item.title || item.name || item.url, url: item.url, note: item.note || "", favIconUrl: item.favIconUrl || "" });
      }
      count += 1;
    } catch (error) {
      throw new Error(`导入中断（已完成 ${count} 个集合，当前集合可能已部分导入）：${error.message}`);
    }
  }
  return count;
}
