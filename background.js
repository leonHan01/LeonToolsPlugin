const PENDING_KEY = "pendingAdd";

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.error("setPanelBehavior failed", error);
  }

  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: "add-to-collection",
    title: "加入网页集合",
    contexts: ["page", "link", "action"],
  });
  chrome.contextMenus.create({
    id: "open-side-panel",
    title: "打开 Leon Tools Pro 侧边栏",
    contexts: ["page", "action"],
  });
});

chrome.runtime.onStartup.addListener(async () => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.error("setPanelBehavior failed", error);
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab) return;

  if (info.menuItemId === "open-side-panel") {
    await chrome.sidePanel.open({ windowId: tab.windowId });
    return;
  }

  if (info.menuItemId === "add-to-collection") {
    const url = info.linkUrl || info.pageUrl || tab.url || "";
    const title =
      info.linkUrl && info.linkUrl !== tab.url
        ? info.linkText || hostnameOf(url) || url
        : tab.title || hostnameOf(url) || url;

    await chrome.storage.session.set({
      [PENDING_KEY]: {
        title,
        url,
        favIconUrl: tab.favIconUrl || "",
        source: "context-menu",
        createdAt: Date.now(),
      },
    });
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "OPEN_OR_FOCUS") return;
  openOrFocusTab(message.url, message.active !== false)
    .then(sendResponse)
    .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
  return true;
});

function tabHref(tab) {
  return tab?.url || tab?.pendingUrl || "";
}

function pathKey(url) {
  try {
    const parsed = new URL(url);
    let path = parsed.pathname || "/";
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    return `${parsed.protocol}//${host}${path}`;
  } catch {
    return String(url || "")
      .replace(/#.*$/, "")
      .replace(/\/+$/, "");
  }
}

function urlsMatch(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  return pathKey(left) === pathKey(right);
}

async function findExistingTab(url) {
  const tabs = await chrome.tabs.query({});
  return tabs.find((tab) => urlsMatch(tabHref(tab), url)) || null;
}

async function openOrFocusTab(url, active = true) {
  const existing = await findExistingTab(url);
  if (existing) {
    if (active) {
      await chrome.tabs.update(existing.id, { active: true });
      try {
        await chrome.windows.update(existing.windowId, { focused: true });
      } catch {
        /* ignore */
      }
    }
    return { id: existing.id, windowId: existing.windowId, reused: true };
  }
  const created = await chrome.tabs.create({ url, active });
  return { id: created.id, windowId: created.windowId, reused: false };
}
