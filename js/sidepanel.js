import { el, icon, faviconImg, restoreFocus } from "./dom.js";
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
import { renderTool, renderToolsHome } from "./tools.js";

const ui = {
  tab: "collections",
  collectionId: null,
  toolId: null,
  search: "",
  toastTimer: 0,
};

let state = { collections: [] };
let currentTab = null;
let applyingRemote = false;

const currentPageEl = document.getElementById("current-page");
const contentEl = document.getElementById("content");
const sheetRoot = document.getElementById("sheet-root");
const toastEl = document.getElementById("toast");

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => switchTab(button.dataset.tab));
});

init();

async function init() {
  const savedUi = await loadUi();
  ui.tab = savedUi.lastTab === "tools" ? "tools" : "collections";
  ui.collectionId = savedUi.lastCollectionId || null;
  await refreshState();
  await refreshActiveTab();
  await consumePendingAdd();
  render();
  syncTabButtons();
  syncInBackground();

  chrome.tabs.onActivated.addListener(refreshActiveTabAndRender);
  chrome.tabs.onUpdated.addListener((_id, info, tab) => {
    if (tab.active && (info.title || info.url || info.favIconUrl || info.status === "complete")) {
      refreshActiveTabAndRender();
    }
  });
  chrome.storage.session.onChanged.addListener((changes) => {
    if (changes.pendingAdd) consumePendingAdd();
  });
  chrome.storage.local.onChanged.addListener((changes) => {
    if (applyingRemote) return;
    if (changes["myWorkflow.v1"]) refreshState().then(render);
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

async function refreshActiveTabAndRender() {
  const active = document.activeElement;
  const focus = {
    id: active?.id,
    start: active?.selectionStart,
    end: active?.selectionEnd,
  };
  await refreshActiveTab();
  renderCurrentPage();
  restoreFocus(focus.id, focus.start, focus.end);
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

function openSheet(title, body, actions) {
  const backdrop = el("div", { class: "sheet-backdrop", onClick: (event) => event.target === backdrop && closeSheet() });
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

function render() {
  renderCurrentPage();
  if (ui.tab === "tools") renderTools();
  else if (ui.collectionId) renderCollectionDetail();
  else renderCollectionList();
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
    await refreshState();
    render();
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

function renderCurrentPage() {
  const page = pageFromTab();
  if (!page) {
    currentPageEl.replaceChildren(el("div", { class: "meta", style: { gridColumn: "1 / -1" } }, el("strong", {}, "没有可加入的标签页"), el("small", {}, "打开一个网页后再加入集合")));
    return;
  }
  const savedHere = ui.collectionId ? currentSaved(ui.collectionId) : null;
  const savedAnywhere = currentSaved(null);
  const addLabel = ui.collectionId ? "加入此集合" : "加入集合";
  const hint = savedHere ? page.url : savedAnywhere ? `${page.url} · 已收藏` : page.url;
  currentPageEl.replaceChildren(
    faviconImg(page.url, page.favIconUrl, "favicon lg"),
    el(
      "div",
      { class: "meta" },
      el("strong", { title: page.title }, page.title),
      el("small", { title: page.url }, hint)
    ),
    savedHere
      ? el("span", { class: "badge ok" }, icon("check"), "已收藏")
      : el(
          "button",
          {
            class: "btn success",
            type: "button",
            onClick: () => openAddSheet(page),
          },
          icon("plus"),
          addLabel
        )
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
    if (item.onClick) {
      nodes.push(el("button", { class: "crumb-link", type: "button", onClick: item.onClick }, item.label));
    } else {
      nodes.push(el("span", { class: "crumb-current", title: item.label }, item.label));
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
      el("span", { class: "dot", style: { background: collection.color } }),
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
  const saved = currentSaved();

  contentEl.replaceChildren(
    breadcrumb([
      { label: "集合列表", onClick: goCollectionList },
      { label: collection.name },
    ]),
    el(
      "div",
      { class: "detail-header" },
      collection.description ? el("p", { class: "desc" }, collection.description) : null,
      el(
        "div",
        { class: "row" },
        el(
          "button",
          {
            class: "btn success",
            type: "button",
            disabled: !pageFromTab() || Boolean(saved),
            onClick: () => openAddSheet(pageFromTab(), collection.id),
          },
          icon("plus"),
          saved ? "当前页已在集合中" : "加入当前页"
        ),
        el("button", { class: "btn", type: "button", onClick: () => openAll(collection) }, icon("external"), "全部打开"),
        el("button", { class: "btn icon", type: "button", title: "编辑集合", onClick: () => openCollectionSheet(collection) }, icon("pencil"))
      )
    ),
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
      el("button", { class: "btn icon", type: "button", title: "新建分组", onClick: () => openGroupSheet(collection) }, icon("plus"))
    ),
    el(
      "div",
      { class: "group-list" },
      collection.groups.map((group) => renderGroup(collection, group, keyword))
    )
  );
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
  const row = el(
    "div",
    { class: "item-row" },
    canDrag ? dragHandle({ type: "item", id: item.id, groupId: group.id }) : el("span", { class: "drag-handle" }),
    faviconImg(item.url, item.favIconUrl),
    el(
      "button",
      {
        class: "item-main",
        type: "button",
        style: { background: "transparent", border: "0", padding: "0", textAlign: "left", color: "inherit", minWidth: "0" },
        onClick: () => openOrFocusTab(item.url),
      },
      el("strong", { title: item.title }, item.title),
      el("small", { title: item.url }, item.url),
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

async function openAll(collection) {
  const items = collection.groups.flatMap((group) => group.items);
  if (!items.length) {
    toast("这个集合还没有网页");
    return;
  }
  if (items.length > 12 && !window.confirm(`将打开最多 ${items.length} 个标签页，已打开的会直接跳转。确定继续？`)) return;
  let created = 0;
  for (let index = 0; index < items.length; index += 1) {
    const result = await openOrFocusTab(items[index].url, { active: index === 0 });
    if (result && result.reused === false) created += 1;
  }
  toast(created ? `已打开 ${created} 个网页` : "这些网页都已在标签页中");
}

function openCollectionSheet(collection = null, { addPage } = {}) {
  const name = el("input", { class: "input", id: "collection-name", value: collection?.name || "", placeholder: "例如：A 项目调研资料" });
  const description = el("textarea", { class: "textarea", id: "collection-desc", placeholder: "记录这个集合的用途", text: collection?.description || "" });
  openSheet(
    collection ? "编辑网页集合" : "新建网页集合",
    el("div", { class: "stack" }, el("div", { class: "field" }, el("label", {}, "集合名称"), name), el("div", { class: "field" }, el("label", {}, "描述"), description)),
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
              await updateCollection(collection.id, { name: name.value, description: description.value });
              toast("集合已更新");
            } else {
              const created = await createCollection({ name: name.value, description: description.value });
              ui.collectionId = created.id;
              saveUi({ lastCollectionId: created.id, lastTab: "collections" });
              if (addPage?.url) {
                await addPageToCollection(created.id, created.groups[0].id, addPage);
                toast("已创建集合并加入当前页");
              } else {
                toast("集合已创建");
              }
            }
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
    openSheet(
      "先创建一个集合",
      el(
        "div",
        { class: "stack" },
        pagePreview(page),
        el("p", { class: "muted" }, "还没有集合。创建后会把当前网页加进去。"),
        el("div", { class: "field" }, el("label", {}, "集合名称"), name)
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
              const created = await createCollection({ name: name.value, description: "" });
              await addPageToCollection(created.id, created.groups[0].id, page);
              ui.collectionId = created.id;
              saveUi({ lastCollectionId: created.id, lastTab: "collections" });
              closeSheet();
              toast("已加入集合");
              await refreshState();
              render();
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
            saveUi({ lastCollectionId: ui.collectionId, lastTab: "collections" });
            closeSheet();
            toast(result.duplicated ? "该网页已在集合中" : "已加入集合");
            await refreshState();
            render();
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

function confirmDeleteCollection(collection) {
  openSheet(
    "删除集合",
    el("p", {}, `确定删除网页集合「${collection.name}」吗？其中的网页也会一并删除。`),
    [
      el("button", { class: "btn ghost", type: "button", onClick: closeSheet }, "取消"),
      el(
        "button",
        {
          class: "btn danger",
          type: "button",
          onClick: async () => {
            await deleteCollection(collection.id);
            if (ui.collectionId === collection.id) ui.collectionId = null;
            closeSheet();
            toast("集合已删除");
            await refreshState();
            render();
          },
        },
        "删除"
      ),
    ]
  );
}

function confirmDeleteGroup(collection, group) {
  openSheet(
    "删除分组",
    el("p", {}, `确定删除分组「${group.name}」及其中网页吗？`),
    [
      el("button", { class: "btn ghost", type: "button", onClick: closeSheet }, "取消"),
      el(
        "button",
        {
          class: "btn danger",
          type: "button",
          onClick: async () => {
            try {
              await deleteGroup(collection.id, group.id);
              closeSheet();
              await refreshState();
              render();
            } catch (error) {
              toast(error instanceof Error ? error.message : "删除失败");
            }
          },
        },
        "删除"
      ),
    ]
  );
}

function confirmDeleteItem(collection, item) {
  openSheet(
    "删除网页",
    el("p", {}, `确定从集合中移除「${item.title}」吗？`),
    [
      el("button", { class: "btn ghost", type: "button", onClick: closeSheet }, "取消"),
      el(
        "button",
        {
          class: "btn danger",
          type: "button",
          onClick: async () => {
            await deleteItem(collection.id, item.id);
            closeSheet();
            await refreshState();
            render();
          },
        },
        "删除"
      ),
    ]
  );
}

async function renderTools() {
  if (!ui.toolId) {
    contentEl.replaceChildren(renderToolsHome((id) => {
      ui.toolId = id;
      renderTools();
    }));
    return;
  }
  const view = await renderTool(ui.toolId, {
    getActiveTab,
    toast,
    goHome: () => {
      ui.toolId = null;
      renderTools();
    },
    reload: () => renderTools(),
  });
  contentEl.replaceChildren(view);
}
