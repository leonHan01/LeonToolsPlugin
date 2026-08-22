import * as api from "./api.js";
import { STORAGE_MODE_BROWSER, getStorageMode, loadSyncMeta, saveSyncMeta } from "./settings.js";
import {
  fromRemoteCollection,
  isRemoteId,
  loadState,
  saveState,
  sameId,
  withState,
} from "./storage.js";

export function extrasFrom(state) {
  const colors = {};
  const favicons = {};
  for (const collection of state.collections || []) {
    if (collection.color) {
      colors[String(collection.id)] = collection.color;
      if (collection.name) colors[collection.name] = collection.color;
    }
    for (const group of collection.groups || []) {
      for (const item of group.items || []) {
        if (item.favIconUrl && item.url) favicons[normalizeKey(item.url)] = item.favIconUrl;
      }
    }
  }
  return { colors, favicons };
}

function normalizeKey(url) {
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

let lastIdMap = {};

export function getLastIdMap() {
  return lastIdMap;
}

export async function syncNow() {
  const idMap = {};
  lastIdMap = idMap;
  if ((await getStorageMode()) === STORAGE_MODE_BROWSER) {
    return { ok: true, connected: false, skipped: true, idMap };
  }
  const online = await api.isBackendAvailable(true);
  if (!online) {
    await saveSyncMeta({ connected: false, error: "无法连接 Leon Workflow 后端" });
    return { ok: false, connected: false, idMap };
  }

  try {
    await replayDeletes();
    await pushDirty(idMap);
    await pushOrder();
    const local = await loadState();
    const extras = extrasFrom(local);
    const remoteList = await api.listFullCollections();
    const leftover = local.collections.filter((collection) => !isRemoteId(collection.id));
    const collections = [
      ...leftover,
      ...(remoteList || []).map((row) => fromRemoteCollection(row, extras)),
    ];
    await saveState({ collections });
    lastIdMap = idMap;
    await saveSyncMeta({ connected: true, lastSyncAt: Date.now(), error: "" });
    return { ok: true, connected: true, idMap, count: collections.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "同步失败";
    await saveSyncMeta({ connected: false, error: message });
    return { ok: false, connected: false, idMap, error: message };
  }
}

async function pushOrder() {
  const state = await loadState();
  const remoteCollections = state.collections.filter((collection) => isRemoteId(collection.id));
  if (remoteCollections.length) {
    await api.reorderCollections(remoteCollections.map((collection) => collection.id));
  }
  for (const collection of remoteCollections) {
    const groups = (collection.groups || []).filter((group) => isRemoteId(group.id));
    if (groups.length) await api.reorderGroups(collection.id, groups.map((group) => group.id));
    for (const group of groups) {
      const items = (group.items || []).filter((item) => isRemoteId(item.id));
      if (items.length) await api.reorderItems(collection.id, group.id, items.map((item) => item.id));
    }
  }
}

async function replayDeletes() {
  const meta = await loadSyncMeta();
  const remain = [];
  for (const op of meta.pendingDeletes || []) {
    try {
      if (op.kind === "collection") await api.deleteCollection(op.collectionId);
      else if (op.kind === "group") await api.deleteGroup(op.collectionId, op.groupId);
      else if (op.kind === "item") await api.deleteItem(op.collectionId, op.itemId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("不存在")) remain.push(op);
    }
  }
  await saveSyncMeta({ pendingDeletes: remain });
}

async function pushDirty(idMap) {
  const state = await loadState();
  for (const collection of [...state.collections]) {
    if (!isRemoteId(collection.id)) {
      try {
        await pushNewCollection(collection, idMap);
        await withState((current) => remapIds(current, idMap));
      } catch (error) {
        await saveSyncMeta({ connected: false, error: error instanceof Error ? error.message : "上传集合失败" });
      }
      continue;
    }
    try {
      if (collection.dirty) {
        await api.updateCollection(collection.id, {
          name: api.clip(collection.name, 200),
          description: collection.description || "",
        });
      }
      for (const group of collection.groups || []) {
        let groupId = group.id;
        if (!isRemoteId(groupId)) {
          const created = await api.createGroup(collection.id, { name: api.clip(group.name, 120) });
          idMap[groupId] = String(created.id);
          groupId = String(created.id);
        } else if (group.dirty) {
          await api.updateGroup(collection.id, groupId, { name: api.clip(group.name, 120) });
        }
        for (const item of group.items || []) {
          if (!isRemoteId(item.id)) {
            const created = await api.createItem(collection.id, {
              groupId: Number(groupId),
              name: api.clip(item.title, 200),
              url: item.url,
              note: item.note || "",
            });
            idMap[item.id] = String(created.id);
          } else if (item.dirty) {
            await api.updateItem(collection.id, item.id, {
              groupId: Number(groupId),
              name: api.clip(item.title, 200),
              url: item.url,
              note: item.note || "",
            });
          }
        }
      }
    } catch (error) {
      await saveSyncMeta({ connected: false, error: error instanceof Error ? error.message : "同步变更失败" });
    }
  }
  if (Object.keys(idMap).length) {
    await withState((current) => remapIds(current, idMap));
  }
}

async function pushNewCollection(collection, idMap) {
  const remote = await api.createCollection({
    name: api.clip(collection.name, 200),
    description: collection.description || "",
  });
  idMap[collection.id] = String(remote.id);
  const defaultGroup = (remote.groups || [])[0];
  for (let index = 0; index < (collection.groups || []).length; index += 1) {
    const group = collection.groups[index];
    let remoteGroupId;
    if (index === 0 && defaultGroup) {
      remoteGroupId = defaultGroup.id;
      idMap[group.id] = String(remoteGroupId);
      if (group.name && group.name !== defaultGroup.name) {
        await api.updateGroup(remote.id, remoteGroupId, { name: api.clip(group.name, 120) });
      }
    } else {
      const created = await api.createGroup(remote.id, { name: api.clip(group.name, 120) });
      remoteGroupId = created.id;
      idMap[group.id] = String(created.id);
    }
    for (const item of group.items || []) {
      const createdItem = await api.createItem(remote.id, {
        groupId: Number(remoteGroupId),
        name: api.clip(item.title, 200),
        url: item.url,
        note: item.note || "",
      });
      idMap[item.id] = String(createdItem.id);
    }
  }
}

function remapIds(state, idMap) {
  for (const collection of state.collections) {
    if (idMap[collection.id]) collection.id = idMap[collection.id];
    collection.dirty = isRemoteId(collection.id) ? false : collection.dirty;
    for (const group of collection.groups || []) {
      if (idMap[group.id]) group.id = idMap[group.id];
      group.dirty = isRemoteId(group.id) ? false : group.dirty;
      for (const item of group.items || []) {
        if (idMap[item.id]) item.id = idMap[item.id];
        item.dirty = isRemoteId(item.id) ? false : item.dirty;
      }
    }
  }
}

export function applyIdMap(value, idMap) {
  if (value == null) return value;
  return idMap[value] || value;
}

export function collectionDirtyCount(state) {
  let count = 0;
  for (const collection of state.collections || []) {
    if (!isRemoteId(collection.id) || collection.dirty) count += 1;
    for (const group of collection.groups || []) {
      if (!isRemoteId(group.id) || group.dirty) count += 1;
      for (const item of group.items || []) {
        if (!isRemoteId(item.id) || item.dirty) count += 1;
      }
    }
  }
  return count;
}

export { sameId };
