import * as api from "./api.js";
import { openContextMenu } from "./context-menu.js";
import { el, icon, faviconImg, hasIcon } from "./dom.js";
import { mergeDirtyWithRemote, pushDirtyRecords, withBackend } from "./persist.js";
import { TOOLBOX_KEY } from "./settings.js";
import { hostnameOf, normalizeUrl } from "./storage.js";

function emptyToolbox() {
  return { items: [] };
}

export async function loadToolbox() {
  const data = await chrome.storage.local.get(TOOLBOX_KEY);
  const stored = data[TOOLBOX_KEY];
  if (!stored || !Array.isArray(stored.items)) return emptyToolbox();
  return stored;
}

export async function saveToolbox(state) {
  await chrome.storage.local.set({ [TOOLBOX_KEY]: state });
}

function fromRemote(item) {
  return {
    id: String(item.id),
    title: item.name || item.title || item.url,
    url: item.url,
    favIconUrl: item.favIconUrl || "",
    icon: item.icon || "",
    sortOrder: item.sortOrder ?? 0,
    createdAt: api.parseTime(item.createTime),
    updatedAt: api.parseTime(item.updateTime),
    dirty: false,
  };
}

export async function refreshToolboxFromBackend() {
  const local = await loadToolbox();
  if (!(await api.shouldUseBackend(true))) return local;
  const next = await withBackend("加载工具箱失败", async () => {
    const remote = (await api.listToolbox() || []).map(fromRemote);
    const merged = { items: mergeDirtyWithRemote(local.items, remote) };
    await saveToolbox(merged);
    return merged;
  });
  return next || local;
}

export function findToolboxItemByUrl(items, url) {
  const target = normalizeUrl(url);
  return items.find((item) => normalizeUrl(item.url) === target) || null;
}

export async function addToToolbox(page) {
  if (!page?.url) throw new Error("没有可加入的网页");
  const state = await loadToolbox(); const existing = findToolboxItemByUrl(state.items, page.url);
  if (existing) return { item: existing, duplicated: true };
  const item = fromRemote(await api.createToolboxItem({ name: api.clip(page.title || hostnameOf(page.url) || page.url, 200), url: page.url, favIconUrl: page.favIconUrl || "", icon: "" }));
  const latest = await loadToolbox(); if (!latest.items.some((entry) => String(entry.id) === item.id)) latest.items.unshift(item); await saveToolbox(latest);
  return { item, duplicated: false };
}

export async function updateToolboxItem(itemId, patch) {
  const state = await loadToolbox(); const item = state.items.find((entry) => String(entry.id) === String(itemId));
  if (!item) throw new Error("工具不存在");
  if (!api.isRemoteId(itemId)) throw new Error("旧本地工具尚未同步到后端");
  const updated = { ...item, title: patch.title != null ? String(patch.title).trim() || item.title : item.title,
    url: patch.url != null ? String(patch.url).trim() : item.url, icon: patch.icon != null ? String(patch.icon || "").trim() : item.icon, updatedAt: Date.now(), dirty: false };
  await api.updateToolboxItem(itemId, { name: updated.title, url: updated.url, favIconUrl: updated.favIconUrl || "", icon: updated.icon || "" });
  const latest = await loadToolbox(); const index = latest.items.findIndex((entry) => String(entry.id) === String(itemId)); if (index >= 0) latest.items[index] = updated; await saveToolbox(latest);
  return updated;
}

export async function deleteToolboxItem(itemId) {
  if (!api.isRemoteId(itemId)) throw new Error("旧本地工具尚未同步到后端");
  await api.deleteToolboxItem(itemId);
  const state = await loadToolbox(); state.items = state.items.filter((item) => String(item.id) !== String(itemId)); await saveToolbox(state);
}

export async function pushLocalToolbox() {
  if (!(await api.shouldUseBackend(true))) return false;
  const state = await loadToolbox();
  const ok = await pushDirtyRecords(state.items, {
    checkpoint: async (item, oldId) => {
      const latest = await loadToolbox();
      const index = latest.items.findIndex((entry) => String(entry.id) === String(oldId));
      if (index >= 0) { latest.items[index] = item; await saveToolbox(latest); }
    },
    create: (item) =>
      api.createToolboxItem({
        name: item.title,
        url: item.url,
        favIconUrl: item.favIconUrl || "",
        icon: item.icon || "",
      }),
    update: (item) =>
      api.updateToolboxItem(item.id, {
        name: item.title,
        url: item.url,
        favIconUrl: item.favIconUrl || "",
        icon: item.icon || "",
      }),
  });
  return ok;
}

export function toolboxMark(item, className = "favicon") {
  if (hasIcon(item.icon)) {
    const wrap = el("span", { class: `${className} toolbox-icon` });
    wrap.append(icon(item.icon));
    return wrap;
  }
  return faviconImg(item.url, item.favIconUrl, className);
}

export function renderToolboxSection({ items, onOpen, onEdit, onDelete, currentItemId } = {}) {
  if (!items.length) {
    return el("div", { class: "toolbox-empty muted" }, "还没有收藏到工具箱的页面，点绿色按钮把当前页加进来。");
  }
  return el(
    "div",
    { class: "tools-grid" },
    items.map((item) => {
      const card = el(
        "article",
        {
          class: `tool-card toolbox-card${String(item.id) === String(currentItemId) ? " current-page" : ""}`,
          dataset: { itemId: String(item.id) },
          "aria-current": String(item.id) === String(currentItemId) ? "true" : null,
        },
        el(
          "button",
          { class: "toolbox-main", type: "button", title: item.title, onClick: () => onOpen(item) },
          toolboxMark(item, "favicon"),
          el("strong", {}, item.title)
        )
      );
      card.addEventListener("contextmenu", (event) => {
        openContextMenu(event, [
          { label: "编辑", icon: "pencil", onClick: () => onEdit(item) },
          { label: "删除", icon: "trash", danger: true, onClick: () => onDelete(item) },
        ]);
      });
      return card;
    })
  );
}
