import * as api from "./api.js";

export function mergeDirtyWithRemote(localItems, remoteItems) {
  const kept = localItems.filter((item) => !api.isRemoteId(item.id) || item.dirty);
  const keptIds = new Set(kept.filter((item) => api.isRemoteId(item.id)).map((item) => String(item.id)));
  return [...kept, ...remoteItems.filter((item) => !keptIds.has(String(item.id)))];
}

export async function withBackend(failMessage, work) {
  try {
    const result = await work();
    await api.markAvailability(true);
    return result === undefined ? true : result;
  } catch (error) {
    await api.markAvailability(false, error instanceof Error ? error.message : failMessage);
    return undefined;
  }
}

export async function pushDirtyRecords(items, { create, update, checkpoint = async () => {} }) {
  let ok = true;
  for (const item of items) {
    try {
      const oldId = item.id;
      if (!api.isRemoteId(item.id)) {
        const remote = await create(item, oldId);
        item.id = String(remote.id);
        item.dirty = false;
      } else if (item.dirty) {
        await update(item);
        item.dirty = false;
      } else {
        continue;
      }
      await checkpoint(item, oldId);
    } catch {
      ok = false;
    }
  }
  return ok;
}
