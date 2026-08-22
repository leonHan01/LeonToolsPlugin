export const STORAGE_KEY = "myWorkflow.v1";
export const UI_KEY = "myWorkflow.ui";
export const SYNC_KEY = "myWorkflow.sync";
export const PENDING_KEY = "pendingAdd";
export const DEFAULT_API_BASE = "http://127.0.0.1:8080";
export const STORAGE_MODE_BACKEND = "backend";
export const STORAGE_MODE_BROWSER = "browser";

export async function loadUi() {
  const data = await chrome.storage.local.get(UI_KEY);
  return {
    lastCollectionId: null,
    lastTab: "collections",
    apiBase: DEFAULT_API_BASE,
    storageMode: STORAGE_MODE_BACKEND,
    ...(data[UI_KEY] || {}),
  };
}

export async function saveUi(patch) {
  const current = await loadUi();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [UI_KEY]: next });
  return next;
}

export async function getApiBase() {
  const ui = await loadUi();
  return String(ui.apiBase || DEFAULT_API_BASE).replace(/\/$/, "");
}

export async function getStorageMode() {
  const ui = await loadUi();
  return ui.storageMode === STORAGE_MODE_BROWSER ? STORAGE_MODE_BROWSER : STORAGE_MODE_BACKEND;
}

export async function loadSyncMeta() {
  const data = await chrome.storage.local.get(SYNC_KEY);
  return {
    connected: false,
    lastSyncAt: 0,
    error: "",
    pendingDeletes: [],
    ...(data[SYNC_KEY] || {}),
  };
}

export async function saveSyncMeta(patch) {
  const current = await loadSyncMeta();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [SYNC_KEY]: next });
  return next;
}

export async function queueDelete(op) {
  const meta = await loadSyncMeta();
  const pendingDeletes = [...(meta.pendingDeletes || []), op];
  return saveSyncMeta({ pendingDeletes });
}
