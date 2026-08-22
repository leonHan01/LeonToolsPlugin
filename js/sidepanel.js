import { el, icon, faviconImg, restoreFocus, TOOL_ICONS, hasIcon } from "./dom.js";
import { createIconPicker } from "./icon-picker.js";
import {
  DEFAULT_API_BASE,
  STORAGE_MODE_BACKEND,
  STORAGE_MODE_BROWSER,
  getApiBase,
  getDeepseekKey,
  getFeishuSettings,
  getStorageMode,
  saveDeepseekKey,
  saveFeishuSettings,
} from "./settings.js";
import {
  addPageToCollection,
  clearPendingAdd,
  createCollection,
  createGroup,
  deleteCollection,
  deleteGroup,
  deleteItem,
  findCollection,
  findItemByUrl,
  hostnameOf,
  loadState,
  loadUi,
  matchSavedCard,
  readPendingAdd,
  renameGroup,
  reorderCollections,
  reorderGroups,
  reorderItems,
  saveUi,
  sameId,
  sortedCollections,
  updateCollection,
  updateItem,
} from "./storage.js";
import { applyIdMap, getLastIdMap, syncNow } from "./sync.js";
import { pushLocalNotes, refreshNotesFromBackend, renderNotesPage } from "./notes.js";
import { pushLocalTodos, refreshTodosFromBackend, renderTodosPage } from "./todos.js";
import { pushLocalSessions, refreshSessionsFromBackend, renderChatPage } from "./llm.js";
import {
  addToToolbox,
  deleteToolboxItem,
  loadToolbox,
  pushLocalToolbox,
  refreshToolboxFromBackend,
  renderToolboxSection,
  updateToolboxItem,
} from "./toolbox.js";
import { renderTool, renderToolsHome } from "./tools.js";

const ui = {
  tab: "collections",
  collectionId: null,
  toolId: null,
  search: "",
  toolUrl: "",
  highlight: null,
  toastTimer: 0,
};

let state = { collections: [] };
let currentTab = null;
let applyingRemote = false;

const contentEl = document.getElementById("content");
const sheetRoot = document.getElementById("sheet-root");
const toastEl = document.getElementById("toast");

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => switchTab(button.dataset.tab));
});

const settingsBtn = document.getElementById("settings-btn");
if (settingsBtn) {
  settingsBtn.append(icon("gear"), "设置");
  settingsBtn.addEventListener("click", () => openSettings());
}

init();

async function init() {
  const savedUi = await loadUi();
  ui.tab = ["tools", "notes", "todos", "chat"].includes(savedUi.lastTab) ? savedUi.lastTab : "collections";
  ui.collectionId = savedUi.lastCollectionId || null;
  await refreshState();
  await refreshActiveTab();
  await consumePendingAdd();
  await revealCurrentPage();
  render();
  syncTabButtons();
  syncInBackground();

  chrome.tabs.onActivated.addListener(() => refreshActiveTabAndRender({ follow: true }));
  chrome.tabs.onUpdated.addListener((_id, info, tab) => {
    if (!tab.active) return;
    if (info.url) refreshActiveTabAndRender({ follow: true });
    else if (info.title || info.favIconUrl || info.status === "complete") refreshActiveTab();
  });
  chrome.storage.session.onChanged.addListener((changes) => {
    if (changes.pendingAdd) consumePendingAdd();
  });
  chrome.storage.local.onChanged.addListener((changes) => {
    if (applyingRemote) return;
    if (changes["myWorkflow.v1"] || changes["myWorkflow.toolbox.v1"]) {
      refreshView({ follow: true });
    }
  });
}

async function refreshState() {
  state = await loadState();
  if (ui.collectionId && !findCollection(state, ui.collectionId)) {
    const mapped = applyIdMap(ui.collectionId, getLastIdMap());
    ui.collectionId = findCollection(state, mapped) ? mapped : null;
    if (ui.collectionId) saveUi({ lastCollectionId: ui.collectionId });
  }
}

async function getActiveTab() {
  const [focused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (focused?.url) return focused;
  const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
  return current || focused || null;
}

async function refreshActiveTab() {
  currentTab = await getActiveTab();
}

async function refreshActiveTabAndRender({ follow = false } = {}) {
  const active = document.activeElement;
  const focus = {
    id: active?.id,
    start: active?.selectionStart,
    end: active?.selectionEnd,
  };
  await refreshActiveTab();
  if (follow) await revealCurrentPage();
  render();
  syncTabButtons();
  if (!follow) restoreFocus(focus.id, focus.start, focus.end);
}

async function revealCurrentPage() {
  if (sheetRoot.children.length) return;
  const page = pageFromTab();
  const toolbox = await loadToolbox();
  const match = matchSavedCard(page?.url, state.collections, toolbox.items);
  ui.highlight = match;
  if (!match) return;
  if (match.kind === "collection") {
    const changed = ui.tab !== "collections" || !sameId(ui.collectionId, match.collectionId);
    ui.tab = "collections";
    ui.collectionId = match.collectionId;
    ui.search = "";
    if (changed) saveUi({ lastTab: "collections", lastCollectionId: match.collectionId });
    return;
  }
  const changed = ui.tab !== "tools" || ui.toolId;
  ui.tab = "tools";
  ui.toolId = null;
  if (changed) saveUi({ lastTab: "tools", lastCollectionId: ui.collectionId });
}

function scrollToCurrentPage() {
  queueMicrotask(() => {
    document.querySelector(".current-page")?.scrollIntoView({ block: "center" });
  });
}

async function refreshView({ follow = false } = {}) {
  await refreshState();
  if (follow) await revealCurrentPage();
  render();
  syncTabButtons();
}

async function consumePendingAdd() {
  const pending = await readPendingAdd();
  if (!pending?.url) return;
  await clearPendingAdd();
  ui.tab = "collections";
  syncTabButtons();
  render();
  openAddSheet(pending);
}

function switchTab(tab) {
  ui.tab = tab;
  if (tab !== "tools") ui.toolId = null;
  saveUi({ lastTab: tab, lastCollectionId: ui.collectionId });
  syncTabButtons();
  render();
}

function syncTabButtons() {
  document.querySelectorAll(".tab").forEach((button) => {
    const active = button.dataset.tab === ui.tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
}

function toast(message) {
  toastEl.hidden = false;
  toastEl.textContent = message;
  clearTimeout(ui.toastTimer);
  ui.toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, 1800);
}

function closeSheet() {
  sheetRoot.replaceChildren();
}

function confirmDelete(message) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      closeSheet();
      resolve(value);
    };
    openSheet(
      "确认删除",
      el("p", {}, message),
      [
        el("button", { class: "btn ghost", type: "button", onClick: () => finish(false) }, "取消"),
        el("button", { class: "btn danger", type: "button", onClick: () => finish(true) }, "确认删除"),
      ],
      () => finish(false)
    );
  });
}

function openSheet(title, body, actions, onClose) {
  const backdrop = el("div", {
    class: "sheet-backdrop",
    onClick: (event) => {
      if (event.target !== backdrop) return;
      if (onClose) onClose();
      else closeSheet();
    },
  });
  backdrop.append(
    el(
      "div",
      { class: "sheet", role: "dialog", "aria-modal": "true" },
      el("h2", {}, title),
      body,
      actions ? el("div", { class: "sheet-actions" }, actions) : null
    )
  );
  sheetRoot.replaceChildren(backdrop);
}

async function openSettings() {
  const mode = await getStorageMode();
  const base = await getApiBase();
  const backend = el("input", { type: "radio", name: "storage-mode", value: STORAGE_MODE_BACKEND, checked: mode === STORAGE_MODE_BACKEND });
  const browser = el("input", { type: "radio", name: "storage-mode", value: STORAGE_MODE_BROWSER, checked: mode === STORAGE_MODE_BROWSER });
  const apiInput = el("input", { class: "input", id: "api-base", value: base, placeholder: DEFAULT_API_BASE });
  const currentKey = await getDeepseekKey();
  const keyInput = el("input", {
    class: "input",
    id: "deepseek-key",
    type: "password",
    value: currentKey,
    placeholder: "sk-...",
    autocomplete: "off",
  });
  const feishu = await getFeishuSettings();
  const webhookInput = el("input", {
    class: "input",
    id: "feishu-webhook",
    value: feishu.url,
    placeholder: "https://open.feishu.cn/open-apis/bot/v2/hook/...",
    autocomplete: "off",
  });
  const secretInput = el("input", {
    class: "input",
    id: "feishu-secret",
    type: "password",
    value: feishu.secret,
    placeholder: "签名校验密钥，未开启可留空",
    autocomplete: "off",
  });
  openSheet(
    "设置",
    el(
      "div",
      { class: "stack" },
      el("div", { class: "field" }, el("label", {}, "数据保存位置")),
      el("label", { class: "choice" }, backend, el("div", {}, el("strong", {}, "后端"), el("small", {}, "能连上 leon_workflow 时写入数据库；连不上则自动保存在浏览器。"))),
      el("label", { class: "choice" }, browser, el("div", {}, el("strong", {}, "仅浏览器"), el("small", {}, "只保存在本机，不访问后端。"))),
      el("div", { class: "field" }, el("label", {}, "后端地址"), apiInput),
      el("div", { class: "field" }, el("label", {}, "DeepSeek API Key"), keyInput),
      el("div", { class: "field" }, el("label", {}, "飞书 Webhook URL"), webhookInput),
      el("div", { class: "field" }, el("label", {}, "飞书签名密钥"), secretInput)
    ),
    [
      el("button", { class: "btn ghost", type: "button", onClick: closeSheet }, "取消"),
      el(
        "button",
        {
          class: "btn primary",
          type: "button",
          onClick: async () => {
            const storageMode = backend.checked ? STORAGE_MODE_BACKEND : STORAGE_MODE_BROWSER;
            const apiBase = apiInput.value.trim().replace(/\/$/, "") || DEFAULT_API_BASE;
            await saveUi({ storageMode, apiBase });
            const messages = [];
            try {
              await saveDeepseekKey(keyInput.value);
              messages.push("DeepSeek Key 已保存");
            } catch (error) {
              messages.push(error instanceof Error ? error.message : "DeepSeek Key 未能写入数据库");
            }
            try {
              await saveFeishuSettings(webhookInput.value, secretInput.value);
              messages.push("飞书 Webhook 已保存");
            } catch (error) {
              messages.push(error instanceof Error ? error.message : "飞书配置未能写入数据库");
            }
            closeSheet();
            if (storageMode === STORAGE_MODE_BACKEND) await syncInBackground();
            toast(messages.join("；"));
          },
        },
        "保存"
      ),
    ]
  );
}

function render() {
  contentEl.classList.toggle("notes-mode", ui.tab === "notes" || ui.tab === "chat" || ui.tab === "todos");
  if (ui.tab === "tools") renderTools();
  else if (ui.tab === "notes") renderNotes();
  else if (ui.tab === "todos") renderTodos();
  else if (ui.tab === "chat") renderChat();
  else if (ui.collectionId) renderCollectionDetail();
  else renderCollectionList();
}

function renderChat() {
  contentEl.replaceChildren(renderChatPage({ toast, confirmDelete, openSheet, closeSheet }));
}

function renderNotes() {
  contentEl.replaceChildren(renderNotesPage({ toast, confirmDelete, openSheet, closeSheet }));
}

function renderTodos() {
  contentEl.replaceChildren(renderTodosPage({ toast, confirmDelete, openSheet, closeSheet }));
}

async function syncInBackground() {
  applyingRemote = true;
  try {
    const result = await syncNow();
    if (result.idMap) {
      const mapped = applyIdMap(ui.collectionId, result.idMap);
      if (mapped !== ui.collectionId) {
        ui.collectionId = mapped;
        saveUi({ lastCollectionId: mapped });
      }
    }
    await pushLocalNotes();
    await pushLocalTodos();
    await pushLocalToolbox();
    await pushLocalSessions();
    await refreshNotesFromBackend();
    await refreshTodosFromBackend();
    await refreshSessionsFromBackend();
    await refreshView({ follow: true });
  } finally {
    applyingRemote = false;
  }
}

function pageFromTab(tab = currentTab) {
  if (!tab?.url) return null;
  return {
    title: tab.title || hostnameOf(tab.url) || tab.url,
    url: tab.url,
    favIconUrl: tab.favIconUrl || "",
  };
}

function currentSaved(collectionId = ui.collectionId) {
  const page = pageFromTab();
  if (!page) return null;
  return findItemByUrl(state, page.url, collectionId || undefined);
}

function addCurrentPageButton(preferredCollectionId = ui.collectionId) {
  const page = pageFromTab();
  const savedHere = preferredCollectionId ? currentSaved(preferredCollectionId) : null;
  return el(
    "button",
    {
      class: "btn success icon",
      type: "button",
      title: !page ? "没有可加入的标签页" : savedHere ? "当前页已在集合中" : preferredCollectionId ? "加入此集合" : "加入集合",
      disabled: !page || Boolean(savedHere),
      onClick: () => openAddSheet(page, preferredCollectionId || undefined),
    },
    icon("download")
  );
}

function goCollectionList() {
  ui.collectionId = null;
  ui.search = "";
  saveUi({ lastCollectionId: null });
  render();
}

function breadcrumb(items) {
  const nodes = [];
  items.forEach((item, index) => {
    if (index > 0) nodes.push(el("span", { class: "crumb-sep", "aria-hidden": "true" }, "/"));
    const mark = item.icon && hasIcon(item.icon) ? icon(item.icon) : null;
    if (item.onClick) {
      nodes.push(el("button", { class: "crumb-link", type: "button", onClick: item.onClick }, mark, item.label));
    } else {
      nodes.push(el("span", { class: "crumb-current", title: item.label }, mark, item.label));
    }
  });
  return el("nav", { class: "breadcrumb", "aria-label": "面包屑" }, nodes);
}

function renderCollectionList() {
  const keyword = ui.search.trim().toLowerCase();
  const collections = sortedCollections(state).filter((collection) => {
    if (!keyword) return true;
    return `${collection.name} ${collection.description || ""}`.toLowerCase().includes(keyword);
  });

  const list =
    !state.collections.length
      ? el(
          "section",
          { class: "empty" },
          el("h2", {}, "还没有网页集合"),
          el("p", {}, "新建一个集合，把当前标签页和项目资料归到一起。"),
          el("button", { class: "btn primary", type: "button", onClick: () => openCollectionSheet() }, icon("plus"), "新建集合")
        )
      : !collections.length
        ? el("section", { class: "empty" }, el("h2", {}, "没有匹配的集合"), el("p", {}, "换个关键词试试。"))
        : el(
            "div",
            { class: "collection-list" },
            collections.map((collection) => collectionCard(collection))
          );

  contentEl.replaceChildren(
    breadcrumb([{ label: "集合列表" }]),
    el(
      "div",
      { class: "toolbar" },
      el("input", {
        class: "input",
        id: "search-input",
        placeholder: "搜索集合",
        value: ui.search,
        onInput: (event) => {
          ui.search = event.target.value;
          renderCollectionList();
          restoreFocus("search-input", event.target.selectionStart, event.target.selectionEnd);
        },
      }),
      addCurrentPageButton(null),
      el("button", { class: "btn primary icon", type: "button", title: "新建集合", onClick: () => openCollectionSheet() }, icon("plus"))
    ),
    list
  );
}

function dragHandle(payload) {
  const handle = el("span", { class: "drag-handle", title: "拖动排序", draggable: "true" }, icon("grip"));
  handle.addEventListener("dragstart", (event) => {
    event.dataTransfer.setData("text/plain", JSON.stringify(payload));
    event.dataTransfer.effectAllowed = "move";
    handle.closest(".collection-card, .group, .item-row")?.classList.add("dragging");
  });
  handle.addEventListener("dragend", () => {
    document.querySelectorAll(".dragging, .drag-over").forEach((node) => {
      node.classList.remove("dragging", "drag-over");
    });
  });
  handle.addEventListener("click", (event) => event.stopPropagation());
  return handle;
}

function enableDrop(node, type, onDrop) {
  node.addEventListener("dragover", (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    node.classList.add("drag-over");
  });
  node.addEventListener("dragleave", (event) => {
    if (!node.contains(event.relatedTarget)) node.classList.remove("drag-over");
  });
  node.addEventListener("drop", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    node.classList.remove("drag-over");
    let payload = {};
    try {
      payload = JSON.parse(event.dataTransfer.getData("text/plain") || "{}");
    } catch {
      return;
    }
    if (payload.type !== type) return;
    await onDrop(payload);
  });
}

function collectionCard(collection) {
  const canDrag = !ui.search.trim();
  const card = el(
    "article",
    { class: "collection-card" },
    el(
      "div",
      { class: "head" },
      canDrag ? dragHandle({ type: "collection", id: collection.id }) : el("span", { class: "drag-handle" }),
      collectionMark(collection),
      el(
        "button",
        {
          class: "collection-main",
          type: "button",
          onClick: () => openCollection(collection.id),
        },
        el("strong", {}, collection.name),
        el("p", {}, collection.description || "暂无描述")
      )
    ),
    el(
      "div",
      { class: "card-actions" },
      el("button", { class: "btn", type: "button", onClick: () => openCollectionSheet(collection) }, icon("pencil"), "编辑"),
      el("button", { class: "btn danger", type: "button", onClick: () => confirmDeleteCollection(collection) }, icon("trash"), "删除")
    )
  );
  if (canDrag) {
    enableDrop(card, "collection", async (payload) => {
      if (sameId(payload.id, collection.id)) return;
      await reorderCollections(payload.id, collection.id);
      await refreshState();
      render();
    });
  }
  return card;
}

function openCollection(id) {
  ui.collectionId = id;
  ui.search = "";
  saveUi({ lastTab: "collections", lastCollectionId: id });
  render();
}

function renderCollectionDetail() {
  const collection = findCollection(state, ui.collectionId);
  if (!collection) {
    ui.collectionId = null;
    renderCollectionList();
    return;
  }
  const keyword = ui.search.trim().toLowerCase();

  contentEl.replaceChildren(
    ...[
      breadcrumb([
        { label: "集合列表", onClick: goCollectionList },
        { label: collection.name, icon: collection.icon },
      ]),
      collection.description ? el("div", { class: "detail-header" }, el("p", { class: "desc" }, collection.description)) : null,
      el(
        "div",
        { class: "toolbar" },
        el("input", {
          class: "input",
          id: "search-input",
          placeholder: "搜索网页标题或链接",
          value: ui.search,
          onInput: (event) => {
            ui.search = event.target.value;
            renderCollectionDetail();
            restoreFocus("search-input", event.target.selectionStart, event.target.selectionEnd);
          },
        }),
        addCurrentPageButton(collection.id),
        el("button", { class: "btn icon", type: "button", title: "新建分组", onClick: () => openGroupSheet(collection) }, icon("plus"))
      ),
      el(
        "div",
        { class: "group-list" },
        collection.groups.map((group) => renderGroup(collection, group, keyword))
      ),
    ].filter(Boolean)
  );
  scrollToCurrentPage();
}

function renderGroup(collection, group, keyword) {
  const items = group.items.filter((item) => {
    if (!keyword) return true;
    return `${item.title} ${item.url} ${item.note || ""}`.toLowerCase().includes(keyword);
  });
  const canDrag = !keyword;
  const section = el(
    "section",
    { class: "group" },
    el(
      "div",
      { class: "group-header" },
      canDrag ? dragHandle({ type: "group", id: group.id }) : el("span", { class: "drag-handle" }),
      el("strong", {}, group.name),
      el("span", { class: "badge" }, String(group.items.length)),
      el("button", { class: "btn ghost icon", type: "button", title: "重命名", onClick: () => openGroupSheet(collection, group) }, icon("pencil")),
      el(
        "button",
        {
          class: "btn ghost icon",
          type: "button",
          title: "删除分组",
          disabled: collection.groups.length <= 1,
          onClick: () => confirmDeleteGroup(collection, group),
        },
        icon("trash")
      )
    ),
    items.length
      ? items.map((item) => itemRow(collection, group, item, canDrag))
      : el("div", { class: "empty", style: { minHeight: "72px", border: "0", borderRadius: "0" } }, keyword ? "没有匹配的网页" : "这个分组还没有网页")
  );
  if (canDrag) {
    enableDrop(section, "group", async (payload) => {
      if (sameId(payload.id, group.id)) return;
      await reorderGroups(collection.id, payload.id, group.id);
      await refreshState();
      render();
    });
  }
  return section;
}

function itemRow(collection, group, item, canDrag) {
  const current = ui.highlight?.kind === "collection" && sameId(ui.highlight.itemId, item.id);
  const row = el(
    "div",
    {
      class: `item-row${current ? " current-page" : ""}`,
      dataset: { itemId: String(item.id) },
      "aria-current": current ? "true" : null,
    },
    canDrag ? dragHandle({ type: "item", id: item.id, groupId: group.id }) : el("span", { class: "drag-handle" }),
    faviconImg(item.url, item.favIconUrl),
    el(
      "button",
      {
        class: "item-main",
        type: "button",
        style: { background: "transparent", border: "0", padding: "0", textAlign: "left", color: "inherit", minWidth: "0" },
        title: item.title,
        onClick: () => openOrFocusTab(item.url),
      },
      el("strong", {}, item.title),
      item.note ? el("div", { class: "note-chip" }, item.note) : null
    ),
    el(
      "div",
      { class: "item-actions" },
      el("button", { class: "btn ghost icon", type: "button", title: "编辑", onClick: () => openItemSheet(collection, group, item) }, icon("pencil")),
      el("button", { class: "btn ghost icon", type: "button", title: "删除", onClick: () => confirmDeleteItem(collection, item) }, icon("trash"))
    )
  );
  if (canDrag) {
    enableDrop(row, "item", async (payload) => {
      if (!sameId(payload.groupId, group.id) || sameId(payload.id, item.id)) return;
      await reorderItems(collection.id, group.id, payload.id, item.id);
      await refreshState();
      render();
    });
  }
  return row;
}

async function openOrFocusTab(url, { active = true } = {}) {
  const result = await chrome.runtime.sendMessage({ type: "OPEN_OR_FOCUS", url, active });
  if (result?.error) throw new Error(result.error);
  return result;
}

function collectionMark(collection) {
  if (hasIcon(collection?.icon)) {
    const wrap = el("span", { class: "collection-icon", style: { color: collection.color } });
    wrap.append(icon(collection.icon));
    return wrap;
  }
  return el("span", { class: "dot", style: { background: collection?.color } });
}

function collectionIconPicker(initial) {
  return createIconPicker({
    choices: [{ id: "", label: "默认圆点" }, ...TOOL_ICONS.filter((item) => item.id !== "favicon")],
    initial: hasIcon(initial) ? initial : "",
    markFor: (entry) => (entry.id ? icon(entry.id) : el("span", { class: "dot" })),
  });
}

function openCollectionSheet(collection = null, { addPage } = {}) {
  const name = el("input", { class: "input", id: "collection-name", value: collection?.name || "", placeholder: "例如：A 项目调研资料" });
  const description = el("textarea", { class: "textarea", id: "collection-desc", placeholder: "记录这个集合的用途", text: collection?.description || "" });
  const picker = collectionIconPicker(collection?.icon);
  openSheet(
    collection ? "编辑网页集合" : "新建网页集合",
    el(
      "div",
      { class: "stack" },
      el("div", { class: "field" }, el("label", {}, "集合名称"), name),
      el("div", { class: "field" }, el("label", {}, "描述"), description),
      el("div", { class: "field" }, el("label", {}, "图标"), picker.node)
    ),
    [
      el("button", { class: "btn ghost", type: "button", onClick: closeSheet }, "取消"),
      el(
        "button",
        {
          class: "btn primary",
          type: "button",
          onClick: async () => {
            if (!name.value.trim()) {
              name.focus();
              return;
            }
            if (collection) {
              await updateCollection(collection.id, { name: name.value, description: description.value, icon: picker.value() });
              toast("集合已更新");
            } else {
              const created = await createCollection({ name: name.value, description: description.value, icon: picker.value() });
              ui.collectionId = created.id;
              saveUi({ lastCollectionId: created.id, lastTab: ui.tab });
              if (addPage?.url) {
                await addPageToCollection(created.id, created.groups[0].id, addPage);
                toast("已创建集合并加入当前页");
              } else {
                toast("集合已创建");
              }
            }
            closeSheet();
            await refreshView({ follow: Boolean(addPage?.url) });
          },
        },
        "保存"
      ),
    ]
  );
  name.focus();
}

function openGroupSheet(collection, group = null) {
  const name = el("input", { class: "input", id: "group-name", value: group?.name || "", placeholder: "例如：文档、后台、参考站" });
  openSheet(
    group ? "重命名分组" : "新建分组",
    el("div", { class: "field" }, el("label", {}, "分组名称"), name),
    [
      el("button", { class: "btn ghost", type: "button", onClick: closeSheet }, "取消"),
      el(
        "button",
        {
          class: "btn primary",
          type: "button",
          onClick: async () => {
            if (!name.value.trim()) {
              name.focus();
              return;
            }
            if (group) await renameGroup(collection.id, group.id, name.value);
            else await createGroup(collection.id, name.value);
            closeSheet();
            await refreshState();
            render();
          },
        },
        "保存"
      ),
    ]
  );
  name.focus();
}

function openAddSheet(page, preferredCollectionId = ui.collectionId) {
  if (!page?.url) {
    toast("当前没有可加入的网页");
    return;
  }
  if (!state.collections.length) {
    const name = el("input", { class: "input", id: "collection-name", value: hostnameOf(page.url) || "新集合", placeholder: "集合名称" });
    const picker = collectionIconPicker("");
    openSheet(
      "先创建一个集合",
      el(
        "div",
        { class: "stack" },
        pagePreview(page),
        el("p", { class: "muted" }, "还没有集合。创建后会把当前网页加进去。"),
        el("div", { class: "field" }, el("label", {}, "集合名称"), name),
        el("div", { class: "field" }, el("label", {}, "图标"), picker.node)
      ),
      [
        el("button", { class: "btn ghost", type: "button", onClick: closeSheet }, "取消"),
        el(
          "button",
          {
            class: "btn primary",
            type: "button",
            onClick: async () => {
              if (!name.value.trim()) return name.focus();
              const created = await createCollection({ name: name.value, description: "", icon: picker.value() });
              await addPageToCollection(created.id, created.groups[0].id, page);
              ui.collectionId = created.id;
              saveUi({ lastCollectionId: created.id, lastTab: ui.tab });
              closeSheet();
              toast("已加入集合");
              await refreshView({ follow: true });
            },
          },
          "创建并加入"
        ),
      ]
    );
    name.focus();
    return;
  }

  const selectedId = preferredCollectionId && findCollection(state, preferredCollectionId)
    ? preferredCollectionId
    : sortedCollections(state)[0].id;
  const collectionSelect = el(
    "select",
    { class: "select", id: "add-collection" },
    sortedCollections(state).map((collection) =>
      el("option", { value: collection.id, selected: sameId(collection.id, selectedId) }, collection.name)
    )
  );
  const groupSelect = el("select", { class: "select", id: "add-group" });
  const note = el("textarea", { class: "textarea", id: "add-note", placeholder: "可选备注，例如登录方式或阅读重点" });

  const fillGroups = () => {
    const collection = findCollection(state, collectionSelect.value);
    groupSelect.replaceChildren(
      ...(collection?.groups || []).map((group) => el("option", { value: group.id }, group.name))
    );
  };
  collectionSelect.addEventListener("change", fillGroups);
  fillGroups();

  openSheet(
    "加入网页集合",
    el(
      "div",
      { class: "stack" },
      pagePreview(page),
      el("div", { class: "field" }, el("label", {}, "集合"), collectionSelect),
      el("div", { class: "field" }, el("label", {}, "分组"), groupSelect),
      el("div", { class: "field" }, el("label", {}, "备注"), note),
      el("button", { class: "btn ghost", type: "button", onClick: () => { closeSheet(); openCollectionSheet(null, { addPage: page }); } }, icon("plus"), "新建集合")
    ),
    [
      el("button", { class: "btn ghost", type: "button", onClick: closeSheet }, "取消"),
      el(
        "button",
        {
          class: "btn primary",
          type: "button",
          onClick: async () => {
            const result = await addPageToCollection(collectionSelect.value, groupSelect.value, {
              ...page,
              note: note.value,
            });
            ui.collectionId = collectionSelect.value;
            saveUi({ lastCollectionId: ui.collectionId, lastTab: ui.tab });
            closeSheet();
            toast(result.duplicated ? "该网页已在集合中" : "已加入集合");
            await refreshView({ follow: true });
          },
        },
        "加入"
      ),
    ]
  );
}

function pagePreview(page) {
  return el(
    "div",
    { class: "page-preview" },
    faviconImg(page.url, page.favIconUrl, "favicon lg"),
    el("div", { class: "meta" }, el("strong", {}, page.title || hostnameOf(page.url)), el("small", {}, page.url))
  );
}

function openItemSheet(collection, group, item) {
  const title = el("input", { class: "input", value: item.title });
  const url = el("input", { class: "input", value: item.url });
  const note = el("textarea", { class: "textarea", text: item.note || "" });
  const groupSelect = el(
    "select",
    { class: "select" },
    collection.groups.map((entry) => el("option", { value: entry.id, selected: sameId(entry.id, group.id) }, entry.name))
  );
  openSheet(
    "编辑网页",
    el(
      "div",
      { class: "stack" },
      el("div", { class: "field" }, el("label", {}, "分组"), groupSelect),
      el("div", { class: "field" }, el("label", {}, "名称"), title),
      el("div", { class: "field" }, el("label", {}, "URL"), url),
      el("div", { class: "field" }, el("label", {}, "备注"), note)
    ),
    [
      el("button", { class: "btn ghost", type: "button", onClick: closeSheet }, "取消"),
      el(
        "button",
        {
          class: "btn primary",
          type: "button",
          onClick: async () => {
            if (!title.value.trim() || !url.value.trim()) return;
            await updateItem(collection.id, item.id, {
              title: title.value,
              url: url.value,
              note: note.value,
              groupId: groupSelect.value,
            });
            closeSheet();
            await refreshState();
            render();
          },
        },
        "保存"
      ),
    ]
  );
}

async function confirmDeleteCollection(collection) {
  const ok = await confirmDelete(`确定删除集合「${collection.name}」吗？其中的网页也会一并删除，此操作不可恢复。`);
  if (!ok) return;
  await deleteCollection(collection.id);
  if (ui.collectionId === collection.id) ui.collectionId = null;
  toast("集合已删除");
  await refreshState();
  render();
}

async function confirmDeleteGroup(collection, group) {
  const ok = await confirmDelete(`确定删除分组「${group.name}」及其中网页吗？此操作不可恢复。`);
  if (!ok) return;
  try {
    await deleteGroup(collection.id, group.id);
    await refreshState();
    render();
  } catch (error) {
    toast(error instanceof Error ? error.message : "删除失败");
  }
}

async function confirmDeleteItem(collection, item) {
  const ok = await confirmDelete(`确定从集合中移除「${item.title}」吗？此操作不可恢复。`);
  if (!ok) return;
  await deleteItem(collection.id, item.id);
  await refreshState();
  render();
}

function openToolboxEdit(item) {
  const title = el("input", { class: "input", value: item.title });
  const url = el("input", { class: "input", value: item.url });
  const picker = createIconPicker({
    choices: TOOL_ICONS,
    initial: hasIcon(item.icon) ? item.icon : "favicon",
    markFor: (entry) =>
      entry.id === "favicon"
        ? faviconImg(url.value.trim() || item.url, item.favIconUrl, "favicon")
        : icon(entry.id),
  });
  url.addEventListener("change", () => {
    if (picker.value() === "favicon") picker.redraw();
  });

  openSheet(
    "编辑工具",
    el(
      "div",
      { class: "stack" },
      el("div", { class: "field" }, el("label", {}, "名称"), title),
      el("div", { class: "field" }, el("label", {}, "网址"), url),
      el("div", { class: "field" }, el("label", {}, "图标"), picker.node)
    ),
    [
      el("button", { class: "btn ghost", type: "button", onClick: closeSheet }, "取消"),
      el(
        "button",
        {
          class: "btn primary",
          type: "button",
          onClick: async () => {
            if (!title.value.trim() || !url.value.trim()) return;
            await updateToolboxItem(item.id, {
              title: title.value,
              url: url.value,
              icon: picker.value() === "favicon" ? "" : picker.value(),
            });
            closeSheet();
            await renderTools();
          },
        },
        "保存"
      ),
    ]
  );
}

async function removeToolboxItem(item) {
  const ok = await confirmDelete(`确定从工具箱移除「${item.title}」吗？此操作不可恢复。`);
  if (!ok) return;
  await deleteToolboxItem(item.id);
  await renderTools();
}

function toolsAddBar() {
  const input = el("input", {
    class: "input",
    id: "tool-url",
    placeholder: "当前页面网址",
    value: ui.toolUrl || "",
    onInput: (event) => {
      ui.toolUrl = event.target.value;
    },
  });
  return el(
    "div",
    { class: "toolbar" },
    input,
    el(
      "button",
      {
        class: "btn success icon",
        type: "button",
        title: "加入当前页面到工具箱",
        onClick: async () => {
          await refreshActiveTab();
          const live = pageFromTab();
          const typed = input.value.trim();
          const page = live?.url && (!typed || typed === live.url)
            ? live
            : typed
              ? { title: hostnameOf(typed) || typed, url: typed, favIconUrl: "" }
              : live;
          if (!page?.url) {
            toast("没有可加入的网页");
            return;
          }
          ui.toolUrl = page.url;
          input.value = page.url;
          const urlInput = document.getElementById("url-source");
          if (urlInput) urlInput.value = page.url;
          try {
            const result = await addToToolbox(page);
            toast(result.duplicated ? "该页面已在工具箱中" : "已加入工具箱");
            await revealCurrentPage();
            if (!ui.toolId) await renderTools();
          } catch (error) {
            toast(error instanceof Error ? error.message : "加入工具箱失败");
          }
        },
      },
      icon("download")
    )
  );
}

async function renderTools() {
  await refreshActiveTab();
  if (!ui.toolUrl) {
    const page = pageFromTab();
    if (page?.url) ui.toolUrl = page.url;
  }
  if (!ui.toolId) {
    const toolbox = await refreshToolboxFromBackend();
    contentEl.replaceChildren(
      toolsAddBar(),
      el("div", { class: "section-label" }, "我的工具"),
      renderToolboxSection({
        items: toolbox.items,
        currentItemId: ui.highlight?.kind === "toolbox" ? ui.highlight.itemId : null,
        onOpen: (item) => openOrFocusTab(item.url),
        onEdit: (item) => openToolboxEdit(item),
        onDelete: (item) => removeToolboxItem(item),
      }),
      el("div", { class: "section-label" }, "内置工具"),
      renderToolsHome((id) => {
        ui.toolId = id;
        renderTools();
      })
    );
    scrollToCurrentPage();
    return;
  }
  const view = await renderTool(ui.toolId, {
    getActiveTab,
    toast,
    confirmDelete,
    initialUrl: ui.toolUrl,
    goHome: () => {
      ui.toolId = null;
      renderTools();
    },
    reload: () => renderTools(),
  });
  contentEl.replaceChildren(toolsAddBar(), view);
}
