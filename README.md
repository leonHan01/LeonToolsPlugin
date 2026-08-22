# Leon Tools Pro

A Chrome side-panel extension for collecting web pages by project, plus notes, todos, an LLM chat, and small browser utilities next to the current tab.

It can use [leon_workflow](../leon_workflow) as a backend. By default it writes to the database when the server is up, and falls back to the browser if it is not.

[中文文档 / Chinese documentation](README.zh-CN.md)

## Features

Five tabs: **Collections**, **Tools**, **Notes**, **Todos**, **LLM**. Settings sit in the footer.

| Area | What it does |
| --- | --- |
| Collections | Group pages by project, drag-reorder, collection icons, focus an existing tab instead of duplicating it |
| Tools | “My tools” bookmark box plus JSON / URL / timestamp utilities |
| Notes | Chat-style sticky notes, local-first then backend |
| Todos | Checklist with done state; composer at the bottom |
| LLM | Multi-session DeepSeek chat; one-click AI analysis of notes and todos |

Deletes ask for confirmation. Collection items and toolbox cards show title (and icon), not the URL.

## Requirements

- Chrome 116+ (side panel)
- Optional: a running [leon_workflow](../leon_workflow) backend, default `http://127.0.0.1:8080`

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** and select this folder (the one with `manifest.json`)
4. Click the toolbar icon to open the side panel

After load or update, allow access to websites and `127.0.0.1`, or tab matching and backend save will not work.

Suggested shortcut: `Alt+Shift+W`. Change it at `chrome://extensions/shortcuts` if it conflicts.

## Settings

Footer **Settings**:

| Field | Purpose |
| --- | --- |
| Storage | **Backend** (default) or **Browser only** |
| API base | Default `http://127.0.0.1:8080` |
| DeepSeek API Key | Cached locally; also stored as `app_setting.DEEPSEEK_API_KEY` when the backend is up |
| Feishu webhook URL | Custom bot URL, e.g. `https://open.feishu.cn/open-apis/bot/v2/hook/...` |
| Feishu signing secret | Required only if the bot uses signature verification |

Backend mode writes to leon_workflow when reachable, otherwise `chrome.storage.local`, then syncs later. Browser-only mode never calls the API.

Restart leon_workflow after backend code changes so JPA can add tables and columns.

## Collections

- Add the current tab; if no collection exists, one is created first.
- Create / edit a collection to pick an icon (same default set as the toolbox). The colored dot is used when no icon is set.
- Duplicate URLs are not added twice in the same collection.
- Breadcrumb: `Collection list` / `{name}`.
- Drag the six-dot handle to reorder collections, groups, and pages. Order is stored as `sort_order` in backend mode.
- Clicking a saved page focuses an existing tab when possible.
- Cards show title (and note), not the URL.
- Right-click a page or link → **Add to webpage collection**.

## Tools

The green download control adds the current page to **My tools** (the toolbox), not to a collection. Toolbox cards support a custom icon and hide the URL.

Built-in tools:

- **Backend sync** — API base and connection status
- **Current page** — copy title, URL, or Markdown; pin, duplicate, mute
- **Tabs** — list window tabs; close duplicates
- **JSON formatter** — pretty-print, minify, validate
- **URL tools** — query params, encode, decode
- **Timestamp** — Unix time and local datetime
- **Import / export** — JSON backup of collections (not notes / todos / chat)

## Notes

- Type at the bottom and press Enter. Data is stored in `/api/notes` or the browser.
- **AI analysis** (top right) sends all notes and todos to the LLM. The reply starts with `TL;DR:` and is also saved as an LLM session named “工作分析”.
- Creating a note can push a Feishu card titled **新增便签** if a webhook is configured.

## Todos

- Bottom composer uses the same send icon as notes.
- Check done, edit, delete. Data goes to `/api/todos` or the browser.
- The same **AI analysis** button covers notes + todos.
- Create and complete events can send Feishu cards (**新增待办**, **完成待办**).

Backend schedule (`Asia/Shanghai`; leon_workflow must be running, webhook stored in the database):

| When | What |
| --- | --- |
| 10:00, 14:00, 20:00 daily | Todo stats card (all / open / done lists), no LLM |
| 00:00 (24:00) | Daily wrap-up: DeepSeek summary starting with `TL;DR:`, then Feishu. Falls back to raw stats if the LLM call fails |

Manual trigger:

```bash
curl -X POST http://127.0.0.1:8080/api/todo-digest/stats
curl -X POST http://127.0.0.1:8080/api/todo-digest/summary
```

## LLM

- Model: `deepseek-v4-flash`, thinking disabled.
- **New**, **History**, click to load. The first user message becomes the session title.
- Each request includes only the **previous five user questions in the same session** as context (no assistant replies).
- Sessions persist via `/api/llm-sessions` or the browser.

## Feishu notifications

Uses a [custom bot webhook](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot). Messages are interactive cards with a colored header.

| Event | Header | Color |
| --- | --- | --- |
| New note | 新增便签 | Blue |
| New todo | 新增待办 | Orange |
| Todo completed | 完成待办 | Green |
| Scheduled stats / wrap-up | 待办统计 / 待办日结 | Blue / purple |

If the bot uses custom keywords, titles already contain 便签 / 待办. Put the signing secret in Settings when signature verification is on.

## Permissions

| Permission | Why |
| --- | --- |
| `sidePanel` | Host the UI |
| `tabs` | Read the current tab and focus an existing one |
| `storage` | Save data and settings locally |
| `contextMenus` | Right-click add to collection |
| `favicon` | Site icons |
| `http://*/*`, `https://*/*` | Tab URLs, DeepSeek, Feishu |
| `localhost` / `127.0.0.1` | leon_workflow API |

## Tests

Extension helper unit tests (Node):

```bash
npm test
node --test --experimental-test-coverage test/*.test.js
```

Backend (notes, todos, LLM, Feishu, scheduled digest, and more):

```bash
cd ../leon_workflow && mvn test
```

Coverage report: `../leon_workflow/target/site/jacoco/index.html`

## Layout

```text
manifest.json          Chrome Manifest V3
background.js          Side panel, context menus, open-or-focus
sidepanel.html         Side panel page
css/sidepanel.css      Styles
js/sidepanel.js        Collections, settings, toolbox edit
js/storage.js          Collection local storage
js/api.js              leon_workflow HTTP client
js/sync.js             Collection push / pull
js/settings.js         API base, storage mode, DeepSeek / Feishu
js/persist.js          Merge dirty local rows with remote lists
js/icon-picker.js      Shared icon picker for collections and tools
js/notes.js            Notes
js/todos.js            Todos
js/llm.js              LLM sessions and DeepSeek
js/work-analysis.js    Notes / todos AI analysis
js/feishu.js           Feishu card notifications
js/toolbox.js          My tools
js/tools.js            Built-in tools
js/dom.js              DOM helpers and icons
js/tool-icons.js       Default icon set
test/                  Extension unit tests
icons/
scripts/make-icons.py
```

Regenerate icons:

```bash
python3 scripts/make-icons.py
```
