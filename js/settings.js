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

const LEGACY_PUBLIC_ORIGIN = "https://121.40.254.112:8080";
const PUBLIC_ORIGIN = "https://121.40.254.112";

function migratePublicBase(base) {
  const value = String(base || DEFAULT_API_BASE).replace(/\/$/, "");
  return value === LEGACY_PUBLIC_ORIGIN ? PUBLIC_ORIGIN : value;
}

export async function loadUi() {
  const data = await chrome.storage.local.get(UI_KEY);
  const { storageMode: _legacyStorageMode, ...stored } = data[UI_KEY] || {};
  return {
    lastCollectionId: null,
    lastTab: "collections",
    apiBase: DEFAULT_API_BASE,
    ...stored,
    apiBase: migratePublicBase(stored.apiBase),
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

// Session storage is cleared when Chrome or the extension is restarted.
const API_CREDENTIAL_KEY = "myWorkflow.apiCredential";

function credentialOrigin(base) {
  const url = new URL(base);
  if (url.username || url.password) throw new Error("后端地址不能包含用户名或密码");
  const localHttp = url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) throw new Error("访问令牌只能用于 HTTPS 或本机 HTTP 地址");
  return url.origin;
}

export async function saveApiToken(base, value) {
  const token = String(value || "").trim();
  if (!token || /\s/.test(token)) throw new Error("请输入有效的访问令牌");
  const origin = credentialOrigin(base);
  await chrome.storage.session.set({ [API_CREDENTIAL_KEY]: { origin, token } });
}

export async function getApiToken(base) {
  const saved = (await chrome.storage.session.get(API_CREDENTIAL_KEY))[API_CREDENTIAL_KEY];
  if (!saved) return "";
  try {
    const origin = credentialOrigin(base);
    const migrated = saved.origin === LEGACY_PUBLIC_ORIGIN && origin === PUBLIC_ORIGIN;
    return saved.origin === origin || migrated ? saved.token : "";
  }
  catch { return ""; }
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
  const remote = await import("./api.js");
  if (!(await remote.isBackendAvailable(true))) {
    throw new Error(offlineMessage);
  }
  await remote.saveAppSetting(remoteKey, next);
  await chrome.storage.local.set({ [localKey]: next });
}

export async function getDeepseekKey() {
  return getCachedSetting(DEEPSEEK_KEY, DEEPSEEK_SETTING_KEY, { keepLocalIfRemoteEmpty: true });
}

export async function saveDeepseekKey(key) {
  return saveCachedSetting(DEEPSEEK_KEY, DEEPSEEK_SETTING_KEY, key, "后端未连接，无法保存 API Key");
}

export async function getFeishuSettings() {
  const [url, secret] = await Promise.all([
    getCachedSetting(FEISHU_WEBHOOK_KEY, FEISHU_WEBHOOK_SETTING_KEY, { keepLocalIfRemoteEmpty: true }),
    getCachedSetting(FEISHU_SECRET_KEY, FEISHU_SECRET_SETTING_KEY, { keepLocalIfRemoteEmpty: true }),
  ]);
  return { url, secret };
}

export async function saveFeishuSettings(url, secret) {
  const nextUrl = String(url || "").trim();
  const nextSecret = String(secret || "").trim();
  const remote = await import("./api.js");
  if (!(await remote.isBackendAvailable(true))) {
    throw new Error("后端未连接，无法保存飞书配置");
  }
  await remote.saveAppSetting(FEISHU_WEBHOOK_SETTING_KEY, nextUrl);
  await remote.saveAppSetting(FEISHU_SECRET_SETTING_KEY, nextSecret);
  await chrome.storage.local.set({ [FEISHU_WEBHOOK_KEY]: nextUrl, [FEISHU_SECRET_KEY]: nextSecret });
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
