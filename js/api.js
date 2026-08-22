import { getApiBase, getStorageMode, STORAGE_MODE_BACKEND, saveSyncMeta } from "./settings.js";

let availability = { at: 0, ok: false };

export function isRemoteId(id) {
  return /^\d+$/.test(String(id ?? ""));
}

export function clip(text, max) {
  const value = String(text || "").trim();
  return value.length <= max ? value : value.slice(0, max);
}

export function parseTime(value) {
  if (value == null || value === "") return Date.now();
  if (typeof value === "number") return value;
  if (Array.isArray(value) && value.length >= 3) {
    const [year, month, day, hour = 0, minute = 0, second = 0] = value;
    return new Date(year, month - 1, day, hour, minute, second).getTime();
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

export async function isBackendAvailable(force = false) {
  if (!force && Date.now() - availability.at < 8000) return availability.ok;
  try {
    const base = await getApiBase();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const response = await fetch(`${base}/api/web-collections`, { signal: controller.signal });
    clearTimeout(timer);
    availability = { at: Date.now(), ok: response.ok };
  } catch {
    availability = { at: Date.now(), ok: false };
  }
  return availability.ok;
}

export async function shouldUseBackend(force = false) {
  if ((await getStorageMode()) !== STORAGE_MODE_BACKEND) return false;
  return isBackendAvailable(force);
}

export function markAvailability(ok, error = "") {
  availability = { at: Date.now(), ok };
  return saveSyncMeta({
    connected: ok,
    error: ok ? "" : error || "无法连接 Leon Workflow 后端",
    ...(ok ? { lastSyncAt: Date.now() } : {}),
  });
}

export async function apiRequest(path, { method = "GET", body } = {}) {
  const base = await getApiBase();
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body != null ? { "Content-Type": "application/json" } : {},
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const message =
      payload && typeof payload === "object"
        ? payload.message || payload.error || `HTTP ${response.status}`
        : String(payload || `HTTP ${response.status}`);
    throw new Error(message);
  }
  if (payload && typeof payload === "object" && "success" in payload && payload.success === false) {
    throw new Error(payload.message || "请求失败");
  }
  if (payload && typeof payload === "object" && "data" in payload) return payload.data;
  return payload;
}

export function listCollections() {
  return apiRequest("/api/web-collections");
}

export async function listFullCollections() {
  try {
    return await apiRequest("/api/web-collections/full");
  } catch {
    const list = await listCollections();
    const details = [];
    for (const row of list || []) {
      details.push(await apiRequest(`/api/web-collections/${row.id}`));
    }
    return details;
  }
}

export function getCollection(id) {
  return apiRequest(`/api/web-collections/${id}`);
}

export function createCollection(payload) {
  return apiRequest("/api/web-collections", { method: "POST", body: payload });
}

export function updateCollection(id, payload) {
  return apiRequest(`/api/web-collections/${id}`, { method: "PUT", body: payload });
}

export function deleteCollection(id) {
  return apiRequest(`/api/web-collections/${id}`, { method: "DELETE" });
}

export function reorderCollections(collectionIds) {
  return apiRequest("/api/web-collections/reorder", {
    method: "PUT",
    body: { collectionIds: collectionIds.map(Number) },
  });
}

export function createGroup(collectionId, payload) {
  return apiRequest(`/api/web-collections/${collectionId}/groups`, { method: "POST", body: payload });
}

export function updateGroup(collectionId, groupId, payload) {
  return apiRequest(`/api/web-collections/${collectionId}/groups/${groupId}`, { method: "PUT", body: payload });
}

export function deleteGroup(collectionId, groupId) {
  return apiRequest(`/api/web-collections/${collectionId}/groups/${groupId}`, { method: "DELETE" });
}

export function reorderGroups(collectionId, groupIds) {
  return apiRequest(`/api/web-collections/${collectionId}/groups/reorder`, {
    method: "PUT",
    body: { groupIds: groupIds.map(Number) },
  });
}

export function createItem(collectionId, payload) {
  return apiRequest(`/api/web-collections/${collectionId}/items`, { method: "POST", body: payload });
}

export function updateItem(collectionId, itemId, payload) {
  return apiRequest(`/api/web-collections/${collectionId}/items/${itemId}`, { method: "PUT", body: payload });
}

export function deleteItem(collectionId, itemId) {
  return apiRequest(`/api/web-collections/${collectionId}/items/${itemId}`, { method: "DELETE" });
}

export function reorderItems(collectionId, groupId, itemIds) {
  return apiRequest(`/api/web-collections/${collectionId}/groups/${groupId}/items/reorder`, {
    method: "PUT",
    body: { itemIds: itemIds.map(Number) },
  });
}
