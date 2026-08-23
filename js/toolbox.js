import * as api from "./api.js";
import { openContextMenu } from "./context-menu.js";
import { el, icon, faviconImg, hasIcon } from "./dom.js";
import { mergeDirtyWithRemote, pushDirtyRecords, withBackend } from "./persist.js";
import { TOOLBOX_KEY } from "./settings.js";
import { hostnameOf, normalizeUrl, uid } from "./storage.js";

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
  const state = await loadToolbox();
  const existing = findToolboxItemByUrl(state.items, page.url);
  if (existing) return { item: existing, duplicated: true };

  const payload = {
    name: api.clip(page.title || hostnameOf(page.url) || page.url, 200),
    url: page.url,
    favIconUrl: page.favIconUrl || "",
    icon: "",
  };

  if (await api.shouldUseBackend()) {
    const item = await withBackend("加入工具箱失败", async () => fromRemote(await api.createToolboxItem(payload)));
    if (item) {
      if (!state.items.some((entry) => String(entry.id) === item.id)) state.items.unshift(item);
      await saveToolbox(state);
      return { item, duplicated: false };
    }
  }

  const item = {
    id: uid(),
    title: payload.name,
    url: page.url,
    favIconUrl: payload.favIconUrl,
    icon: "",
    sortOrder: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    dirty: true,
  };
  state.items.unshift(item);
  await saveToolbox(state);
  return { item, duplicated: false };
}

export async function updateToolboxItem(itemId, patch) {
  const state = await loadToolbox();
  const item = state.items.find((entry) => String(entry.id) === String(itemId));
  if (!item) throw new Error("工具不存在");
  if (patch.title != null) item.title = String(patch.title).trim() || item.title;
  if (patch.url != null) item.url = String(patch.url).trim();
  if (patch.icon != null) item.icon = String(patch.icon || "").trim();
  item.updatedAt = Date.now();
  item.dirty = true;
  await saveToolbox(state);
  if (api.isRemoteId(itemId) && (await api.shouldUseBackend())) {
    const payload = { name: item.title, url: item.url, favIconUrl: item.favIconUrl || "", icon: item.icon || "" };
    const ok = await withBackend("更新工具失败", () => api.updateToolboxItem(itemId, payload));
    if (ok !== undefined) {
      item.dirty = false;
      await saveToolbox(state);
    }
  }
  return item;
}

export async function deleteToolboxItem(itemId) {
  const state = await loadToolbox();
  state.items = state.items.filter((item) => String(item.id) !== String(itemId));
  await saveToolbox(state);
  if (api.isRemoteId(itemId) && (await api.shouldUseBackend())) {
    await withBackend("删除工具失败", () => api.deleteToolboxItem(itemId));
  }
}

export async function pushLocalToolbox() {
  if (!(await api.shouldUseBackend(true))) return;
  const state = await loadToolbox();
  await pushDirtyRecords(state.items, {
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
  await saveToolbox(state);
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
