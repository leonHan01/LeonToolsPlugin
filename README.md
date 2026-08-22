# Leon Tools Pro

Leon Tools Pro is a Chrome side-panel extension for collecting web pages by project and running small browser utilities next to the current tab.

It works with [leon_workflow](../leon_workflow) as an optional backend. By default, collections are saved to leon_workflow when the backend is reachable, and fall back to the browser if it is not.

[中文文档 / Chinese documentation](README.zh-CN.md)

## Features

- Chrome side panel with two tabs: **Collections** and **Tools**
- Create, edit, delete, and drag-reorder webpage collections
- Groups inside a collection, with drag-reorder for groups and pages
- Add the current tab (or a right-clicked link) to a collection
- Open a saved page by focusing an existing tab instead of creating a duplicate
- Local tools: current page actions, tab cleanup, JSON, URL, timestamps, import/export
- Storage mode in Settings: **Backend** (default) or **Browser only**

## Requirements

- Chrome 116+ (side panel and context-menu open)
- Optional: a running [leon_workflow](../leon_workflow) backend, default `http://127.0.0.1:8080`

## Install

1. Open Chrome and go to `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked**
4. Select this repository root (the folder that contains `manifest.json`)
5. Click the toolbar icon to open the side panel

After load or update, Chrome may ask for access to websites and to `127.0.0.1`. Allow those prompts, or tab matching and backend save will not work.

If the keyboard shortcut conflicts, change it at `chrome://extensions/shortcuts`. The suggested shortcut is `Alt+Shift+W`.

## Storage

Open **Settings** (gear in the side panel).

| Mode | Behavior |
| --- | --- |
| **Backend** (default) | Write to leon_workflow `/api/web-collections` when the server is up. If the server is down, write to `chrome.storage.local` and sync later when the backend is available. |
| **Browser only** | Keep collections only in `chrome.storage.local`. The backend is not called. |

Default backend URL: `http://127.0.0.1:8080`. Change it in Settings.

Restart leon_workflow after backend code changes so the `sort_order` column and reorder APIs are available.

## Collections

- The top of the panel shows the current tab. Use **Add to collection** to save it.
- If no collection exists yet, the panel creates one and then adds the page.
- Duplicate URLs are not added twice in the same collection.
- Breadcrumbs: `Collection list` / `{collection name}`. Click the first segment to go back.
- Drag the six-dot handle to reorder collections, groups, and pages. Order is stored in the database when backend mode is on (`web_collection.sort_order`, `web_collection_group.sort_order`, `web_collection_item.sort_order`).
- Click a saved page: if that URL is already open, Chrome switches to that tab; otherwise a new tab is created.
- Right-click a page or link → **Add to webpage collection**.

## Tools

- **Backend sync** — API base URL and connection test
- **Current page** — copy title, URL, or Markdown; pin, duplicate, or mute the tab
- **Tabs** — list tabs in the current window; close duplicates
- **JSON formatter** — pretty-print, minify, validate
- **URL tools** — parse query params, encode, decode
- **Timestamp** — Unix time and local datetime
- **Import / export** — JSON backup of collections

## Permissions

| Permission | Why |
| --- | --- |
| `sidePanel` | Host the UI in Chrome’s side panel |
| `tabs` | Read the current tab and focus an existing tab |
| `storage` | Save collections and settings in the browser |
| `contextMenus` | Right-click “Add to webpage collection” |
| `favicon` | Show site icons |
| `http://*/*`, `https://*/*` | Read open tab URLs so existing tabs can be reused |
| `localhost` / `127.0.0.1` | Talk to the leon_workflow API |

## Project layout

```text
manifest.json        Chrome Manifest V3
background.js        Side panel behavior, context menus, open-or-focus tab
sidepanel.html       Side panel page
css/sidepanel.css    Styles
js/sidepanel.js      Collections UI
js/tools.js          Tools UI
js/storage.js        Browser storage and local CRUD
js/api.js            leon_workflow HTTP client
js/sync.js           Push / pull with the backend
js/settings.js       API base URL and storage mode
js/dom.js            DOM helpers and icons
icons/               Extension icons
scripts/make-icons.py
```

Regenerate icons:

```bash
python3 scripts/make-icons.py
```
