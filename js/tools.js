import { el, icon, faviconImg } from "./dom.js";
import { DEFAULT_API_BASE, getApiBase, loadSyncMeta, saveUi } from "./settings.js";
import { exportJson, formatDateTime, hostnameOf, importJson } from "./storage.js";
import { isBackendAvailable } from "./api.js";
import { syncNow } from "./sync.js";

export const TOOLS = [
  { id: "sync", name: "后端同步", desc: "连接 Leon Workflow 并立即同步", icon: "cloud" },
  { id: "page", name: "当前页面", desc: "复制标题、链接，固定或复制标签", icon: "globe" },
  { id: "tabs", name: "标签页", desc: "查看窗口标签，关闭重复页", icon: "tabs" },
  { id: "json", name: "JSON 格式化", desc: "格式化、压缩、校验 JSON", icon: "json" },
  { id: "url", name: "URL 工具", desc: "编解码和查询参数解析", icon: "link" },
  { id: "time", name: "时间戳", desc: "Unix 时间与本地时间互转", icon: "clock" },
  { id: "data", name: "导入导出", desc: "备份或恢复网页集合", icon: "download" },
];

export function renderToolsHome(onOpen) {
  return el(
    "div",
    { class: "tools-grid" },
    TOOLS.map((tool) =>
      el(
        "button",
        { class: "tool-card", type: "button", onClick: () => onOpen(tool.id) },
        el("span", {}, icon(tool.icon)),
        el("strong", {}, tool.name),
        el("small", {}, tool.desc)
      )
    )
  );
}

export async function renderTool(toolId, { getActiveTab, toast, goHome, reload }) {
  const header = (title) =>
    el(
      "div",
      { class: "detail-header" },
      el("button", { class: "back-link", type: "button", onClick: goHome }, icon("chevronLeft"), "返回工具"),
      el("h1", {}, title)
    );

  if (toolId === "sync") return renderSyncTool(header, toast, reload);
  if (toolId === "page") return renderPageTool(header, getActiveTab, toast, reload);
  if (toolId === "tabs") return renderTabsTool(header, toast, reload);
  if (toolId === "json") return renderJsonTool(header, toast);
  if (toolId === "url") return renderUrlTool(header, toast);
  if (toolId === "time") return renderTimeTool(header, toast);
  if (toolId === "data") return renderDataTool(header, toast, reload);
  return el("div", { class: "empty" }, "未找到该工具");
}

async function renderPageTool(header, getActiveTab, toast, reload) {
  const tab = await getActiveTab();
  const box = el("div", { class: "stack" }, header("当前页面"));
  if (!tab) {
    box.append(el("div", { class: "empty" }, "没有可用的标签页"));
    return box;
  }

  const copy = async (text, label) => {
    await navigator.clipboard.writeText(text);
    toast(`已复制${label}`);
  };

  box.append(
    el(
      "section",
      { class: "panel", style: { padding: "12px" } },
      el("div", { class: "page-preview", style: { margin: "0 0 10px" } }, faviconImg(tab.url, tab.favIconUrl, "favicon lg"), el("div", { class: "meta" }, el("strong", {}, tab.title || "无标题"), el("small", {}, tab.url || ""))),
      el(
        "dl",
        { class: "kv" },
        el("dt", {}, "窗口"),
        el("dd", {}, String(tab.windowId)),
        el("dt", {}, "固定"),
        el("dd", {}, tab.pinned ? "是" : "否"),
        el("dt", {}, "静音"),
        el("dd", {}, tab.mutedInfo?.muted ? "是" : "否")
      )
    ),
    el(
      "div",
      { class: "stack" },
      el("button", { class: "btn block", type: "button", onClick: () => copy(tab.title || "", "标题") }, icon("copy"), "复制标题"),
      el("button", { class: "btn block", type: "button", onClick: () => copy(tab.url || "", "链接") }, icon("copy"), "复制链接"),
      el(
        "button",
        {
          class: "btn block",
          type: "button",
          onClick: () => copy(`[${tab.title || hostnameOf(tab.url)}](${tab.url || ""})`, " Markdown 链接"),
        },
        icon("copy"),
        "复制 Markdown"
      ),
      el(
        "button",
        {
          class: "btn block",
          type: "button",
          onClick: async () => {
            await chrome.tabs.duplicate(tab.id);
            toast("已复制标签页");
            if (reload) reload();
          },
        },
        icon("duplicate"),
        "复制标签页"
      ),
      el(
        "button",
        {
          class: "btn block",
          type: "button",
          onClick: async () => {
            await chrome.tabs.update(tab.id, { pinned: !tab.pinned });
            toast(tab.pinned ? "已取消固定" : "已固定");
            if (reload) reload();
          },
        },
        icon("pin"),
        tab.pinned ? "取消固定" : "固定标签页"
      ),
      el(
        "button",
        {
          class: "btn block",
          type: "button",
          onClick: async () => {
            await chrome.tabs.update(tab.id, { muted: !tab.mutedInfo?.muted });
            toast(tab.mutedInfo?.muted ? "已取消静音" : "已静音");
            if (reload) reload();
          },
        },
        icon("volume"),
        tab.mutedInfo?.muted ? "取消静音" : "静音标签页"
      )
    )
  );
  return box;
}

async function renderTabsTool(header, toast, reload) {
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const windowId = active?.windowId ?? (await chrome.windows.getCurrent()).id;
  const tabs = await chrome.tabs.query({ windowId });
  const byUrl = new Map();
  for (const tab of tabs) {
    const key = tab.url || `id:${tab.id}`;
    if (!byUrl.has(key)) byUrl.set(key, []);
    byUrl.get(key).push(tab);
  }
  const duplicateCount = [...byUrl.values()].reduce((sum, group) => sum + Math.max(0, group.length - 1), 0);

  const box = el(
    "div",
    { class: "stack" },
    header("标签页"),
    el(
      "div",
      { class: "row spread" },
      el("span", { class: "badge" }, `${tabs.length} 个标签`),
      duplicateCount ? el("span", { class: "badge" }, `${duplicateCount} 个重复`) : el("span", { class: "badge ok" }, "无重复")
    ),
    el(
      "button",
      {
        class: "btn danger block",
        type: "button",
        disabled: !duplicateCount,
        onClick: async () => {
          const ids = [];
          for (const group of byUrl.values()) {
            const sorted = [...group].sort((a, b) => Number(b.active) - Number(a.active) || b.id - a.id);
            ids.push(...sorted.slice(1).map((item) => item.id));
          }
          if (!ids.length) return;
          await chrome.tabs.remove(ids);
          toast(`已关闭 ${ids.length} 个重复标签`);
          if (reload) reload();
        },
      },
      icon("trash"),
      "关闭重复标签页"
    ),
    el(
      "div",
      { class: "tab-list" },
      tabs.map((tab) =>
        el(
          "button",
          {
            class: "item-row tab-item",
            type: "button",
            onClick: () => chrome.tabs.update(tab.id, { active: true }),
          },
          faviconImg(tab.url, tab.favIconUrl),
          el("div", { class: "item-main" }, el("strong", {}, tab.title || "无标题"), el("small", {}, tab.url || ""))
        )
      )
    )
  );
  return box;
}

function renderJsonTool(header, toast) {
  const source = el("textarea", { class: "textarea tall", id: "json-source", placeholder: '{ "hello": "world" }' });
  const result = el("pre", { class: "result", id: "json-result" });
  const run = (pretty) => {
    try {
      const parsed = JSON.parse(source.value);
      result.classList.remove("error");
      result.textContent = pretty ? JSON.stringify(parsed, null, 2) : JSON.stringify(parsed);
    } catch (error) {
      result.classList.add("error");
      result.textContent = error instanceof Error ? error.message : "JSON 解析失败";
    }
  };
  source.value = '{\n  "hello": "world"\n}';
  run(true);
  return el(
    "div",
    { class: "stack" },
    header("JSON 格式化"),
    el("div", { class: "field" }, el("label", {}, "输入 JSON"), source),
    el(
      "div",
      { class: "row" },
      el("button", { class: "btn primary", type: "button", onClick: () => run(true) }, "格式化"),
      el("button", { class: "btn", type: "button", onClick: () => run(false) }, "压缩"),
      el(
        "button",
        {
          class: "btn",
          type: "button",
          onClick: async () => {
            await navigator.clipboard.writeText(result.textContent || source.value);
            toast("已复制结果");
          },
        },
        icon("copy"),
        "复制"
      )
    ),
    result
  );
}

function renderUrlTool(header, toast) {
  const source = el("textarea", { class: "textarea", id: "url-source", placeholder: "https://example.com/path?q=hello+world" });
  const result = el("pre", { class: "result", id: "url-result" });
  const write = (text, isError = false) => {
    result.classList.toggle("error", isError);
    result.textContent = text;
  };
  const parse = () => {
    try {
      const url = new URL(source.value.trim());
      const params = [...url.searchParams.entries()].map(([key, value]) => `${key} = ${value}`).join("\n") || "(无查询参数)";
      write(`${url.href}\n\nhost: ${url.host}\npath: ${url.pathname}\n\n${params}`);
    } catch (error) {
      write(error instanceof Error ? error.message : "URL 无效", true);
    }
  };
  return el(
    "div",
    { class: "stack" },
    header("URL 工具"),
    el("div", { class: "field" }, el("label", {}, "输入 URL"), source),
    el(
      "div",
      { class: "row" },
      el("button", { class: "btn primary", type: "button", onClick: parse }, "解析"),
      el(
        "button",
        {
          class: "btn",
          type: "button",
          onClick: () => write(decodeURIComponent(source.value.trim())),
        },
        "解码"
      ),
      el(
        "button",
        {
          class: "btn",
          type: "button",
          onClick: () => write(encodeURIComponent(source.value.trim())),
        },
        "编码"
      ),
      el(
        "button",
        {
          class: "btn",
          type: "button",
          onClick: async () => {
            await navigator.clipboard.writeText(result.textContent);
            toast("已复制结果");
          },
        },
        icon("copy"),
        "复制"
      )
    ),
    result
  );
}

function renderTimeTool(header, toast) {
  const input = el("input", { class: "input", id: "time-input", placeholder: "1710000000 或 2026-03-09 12:00:00" });
  const result = el("pre", { class: "result" });
  const show = (date) => {
    if (Number.isNaN(date.getTime())) {
      result.classList.add("error");
      result.textContent = "无法解析时间";
      return;
    }
    result.classList.remove("error");
    result.textContent = [
      `本地: ${date.toLocaleString("zh-CN")}`,
      `ISO: ${date.toISOString()}`,
      `秒: ${Math.floor(date.getTime() / 1000)}`,
      `毫秒: ${date.getTime()}`,
    ].join("\n");
  };
  const convert = () => {
    const text = input.value.trim();
    if (!text) {
      show(new Date());
      return;
    }
    if (/^\d{10}$/.test(text)) show(new Date(Number(text) * 1000));
    else if (/^\d{13}$/.test(text)) show(new Date(Number(text)));
    else show(new Date(text));
  };
  show(new Date());
  return el(
    "div",
    { class: "stack" },
    header("时间戳"),
    el("div", { class: "field" }, el("label", {}, "时间戳或日期"), input),
    el(
      "div",
      { class: "row" },
      el("button", { class: "btn primary", type: "button", onClick: convert }, "转换"),
      el(
        "button",
        {
          class: "btn",
          type: "button",
          onClick: () => {
            input.value = String(Math.floor(Date.now() / 1000));
            convert();
          },
        },
        "现在"
      ),
      el(
        "button",
        {
          class: "btn",
          type: "button",
          onClick: async () => {
            await navigator.clipboard.writeText(result.textContent);
            toast("已复制结果");
          },
        },
        icon("copy"),
        "复制"
      )
    ),
    result
  );
}

async function renderSyncTool(header, toast, reload) {
  const meta = await loadSyncMeta();
  const base = await getApiBase();
  const input = el("input", { class: "input", id: "api-base", value: base, placeholder: DEFAULT_API_BASE });
  const status = meta.connected
    ? `已连接${meta.lastSyncAt ? ` · 上次同步 ${formatDateTime(meta.lastSyncAt)}` : ""}`
    : meta.error || "未连接";
  return el(
    "div",
    { class: "stack" },
    header("后端同步"),
    el("p", { class: "muted" }, "集合会同时写入浏览器本地，以及 leon_workflow 的 /api/web-collections。请先启动后端（默认 8080）。"),
    el("div", { class: "field" }, el("label", {}, "后端地址"), input),
    el("p", { class: "muted" }, status),
    el(
      "button",
      {
        class: "btn primary block",
        type: "button",
        onClick: async () => {
          const next = input.value.trim().replace(/\/$/, "") || DEFAULT_API_BASE;
          await saveUi({ apiBase: next });
          const result = await syncNow();
          toast(result.ok ? "已保存" : result.error || "保存失败");
          if (reload) reload();
        },
      },
      icon("cloud"),
      "保存并同步"
    ),
    el(
      "button",
      {
        class: "btn block",
        type: "button",
        onClick: async () => {
          const ok = await isBackendAvailable(true);
          toast(ok ? "后端可用" : "连不上后端，请确认 leon_workflow 已启动");
          if (reload) reload();
        },
      },
      "测试连接"
    )
  );
}

function renderDataTool(header, toast, reload) {
  const file = el("input", { type: "file", accept: "application/json,.json", style: { display: "none" } });
  file.addEventListener("change", async () => {
    const picked = file.files?.[0];
    if (!picked) return;
    try {
      const count = await importJson(await picked.text());
      const result = await syncNow();
      toast(result.ok ? `已导入 ${count} 个集合` : `已导入 ${count} 个集合，后端暂不可用`);
      if (reload) reload();
    } catch (error) {
      toast(error instanceof Error ? error.message : "导入失败");
    }
    file.value = "";
  });
  return el(
    "div",
    { class: "stack" },
    header("导入导出"),
    el("p", { class: "muted" }, "导出浏览器里的集合备份。导入后会写入浏览器，并尽量同步到 Leon Workflow。"),
    el(
      "button",
      {
        class: "btn primary block",
        type: "button",
        onClick: async () => {
          const text = await exportJson();
          const blob = new Blob([text], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const stamp = new Date().toISOString().slice(0, 10);
          const link = el("a", { href: url, download: `my-workflow-collections-${stamp}.json` });
          document.body.append(link);
          link.click();
          link.remove();
          URL.revokeObjectURL(url);
          toast("已导出集合");
        },
      },
      icon("download"),
      "导出集合 JSON"
    ),
    el(
      "button",
      {
        class: "btn block",
        type: "button",
        onClick: () => file.click(),
      },
      icon("upload"),
      "导入集合 JSON"
    ),
    file
  );
}
