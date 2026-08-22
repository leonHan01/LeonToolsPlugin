export const STORAGE_KEY = "myWorkflow.v1";
export const NOTES_KEY = "myWorkflow.notes.v1";
export const TODOS_KEY = "myWorkflow.todos.v1";
export const TOOLBOX_KEY = "myWorkflow.toolbox.v1";
export const CHAT_KEY = "myWorkflow.chat.v1";
export const DEEPSEEK_KEY = "myWorkflow.deepseekKey";
export const FEISHU_WEBHOOK_KEY = "myWorkflow.feishuWebhook";
export const FEISHU_SECRET_KEY = "myWorkflow.feishuSecret";
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

export const DEEPSEEK_SETTING_KEY = "DEEPSEEK_API_KEY";
export const FEISHU_WEBHOOK_SETTING_KEY = "FEISHU_WEBHOOK_URL";
export const FEISHU_SECRET_SETTING_KEY = "FEISHU_WEBHOOK_SECRET";

async function getCachedSetting(localKey, remoteKey, { keepLocalIfRemoteEmpty = false } = {}) {
  try {
    const remote = await import("./api.js");
    if (await remote.isBackendAvailable()) {
      const data = await remote.getAppSetting(remoteKey);
      const value = String(data?.value || "").trim();
      if (value || !keepLocalIfRemoteEmpty) {
        await chrome.storage.local.set({ [localKey]: value });
        return value;
      }
    }
  } catch {
    /* use the local cache */
  }
  const data = await chrome.storage.local.get(localKey);
  return String(data[localKey] || "").trim();
}

async function saveCachedSetting(localKey, remoteKey, value, offlineMessage) {
  const next = String(value || "").trim();
  await chrome.storage.local.set({ [localKey]: next });
  const remote = await import("./api.js");
  if (!(await remote.isBackendAvailable(true))) {
    throw new Error(offlineMessage);
  }
  await remote.saveAppSetting(remoteKey, next);
}

export async function getDeepseekKey() {
  return getCachedSetting(DEEPSEEK_KEY, DEEPSEEK_SETTING_KEY, { keepLocalIfRemoteEmpty: true });
}

export async function saveDeepseekKey(key) {
  return saveCachedSetting(DEEPSEEK_KEY, DEEPSEEK_SETTING_KEY, key, "后端未连接，API Key 只保存在浏览器");
}

export async function getFeishuSettings() {
  const [url, secret] = await Promise.all([
    getCachedSetting(FEISHU_WEBHOOK_KEY, FEISHU_WEBHOOK_SETTING_KEY),
    getCachedSetting(FEISHU_SECRET_KEY, FEISHU_SECRET_SETTING_KEY),
  ]);
  return { url, secret };
}

export async function saveFeishuSettings(url, secret) {
  const nextUrl = String(url || "").trim();
  const nextSecret = String(secret || "").trim();
  await chrome.storage.local.set({
    [FEISHU_WEBHOOK_KEY]: nextUrl,
    [FEISHU_SECRET_KEY]: nextSecret,
  });
  const remote = await import("./api.js");
  if (!(await remote.isBackendAvailable(true))) {
    throw new Error("后端未连接，飞书 Webhook 只保存在浏览器");
  }
  await remote.saveAppSetting(FEISHU_WEBHOOK_SETTING_KEY, nextUrl);
  await remote.saveAppSetting(FEISHU_SECRET_SETTING_KEY, nextSecret);
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
