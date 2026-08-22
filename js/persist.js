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
    return result;
  } catch (error) {
    await api.markAvailability(false, error instanceof Error ? error.message : failMessage);
    return undefined;
  }
}
