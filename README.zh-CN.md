# Leon Tools Pro

Leon Tools Pro 是一个 Chrome 侧边栏扩展，用来按项目收纳网页，并在当前标签旁使用一组小工具。

它可以对接 [leon_workflow](../leon_workflow) 作为可选后端。默认在能连上 leon_workflow 时把集合存到后端；连不上则自动保存在浏览器里。

[English documentation / 英文文档](README.md)

## 功能

- Chrome 侧边栏，两个 Tab：**集合**、**工具**
- 新建、编辑、删除网页集合，并支持拖动排序
- 集合内分组，分组和网页都可拖动排序
- 把当前标签页（或右键链接）加入集合
- 打开已保存网页时，若标签已存在则跳转过去，不重复开页
- 本地工具：当前页操作、整理标签、JSON、URL、时间戳、导入导出
- 设置里可选存储位置：**后端**（默认）或 **仅浏览器**

## 环境要求

- Chrome 116+（侧边栏和右键打开侧边栏）
- 可选：已启动的 [leon_workflow](../leon_workflow) 后端，默认地址 `http://127.0.0.1:8080`

## 安装

1. 打开 Chrome，访问 `chrome://extensions`
2. 打开右上角 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择本仓库根目录（包含 `manifest.json` 的文件夹）
5. 点击工具栏上的扩展图标，打开侧边栏

加载或更新后，Chrome 可能会提示访问网站和 `127.0.0.1`。请允许，否则无法定位已打开的标签，也无法把数据写到后端。

若快捷键冲突，到 `chrome://extensions/shortcuts` 修改。建议快捷键为 `Alt+Shift+W`。

## 存储

点击侧边栏右上角 **设置**（齿轮）。

| 模式 | 行为 |
| --- | --- |
| **后端**（默认） | 后端可用时写入 leon_workflow 的 `/api/web-collections`。连不上时写入 `chrome.storage.local`，后端恢复后再同步。 |
| **仅浏览器** | 集合只保存在 `chrome.storage.local`，不访问后端。 |

默认后端地址：`http://127.0.0.1:8080`，可在设置里修改。

leon_workflow 后端代码变更后请重启服务，以便 `sort_order` 字段和排序接口生效。

## 集合

- 侧边栏顶部显示当前标签页，点 **加入集合** 即可保存。
- 还没有集合时，会先创建一个，再把当前页加进去。
- 同一集合里重复的网址不会再加一次。
- 面包屑：`集合列表` / `{集合名称}`。点「集合列表」返回。
- 拖动六点手柄可调整集合、分组、网页的顺序。后端模式下顺序写入数据库（`web_collection.sort_order`、`web_collection_group.sort_order`、`web_collection_item.sort_order`）。
- 点击已保存的网页：如果该地址已有标签页，会直接切过去；否则才新建标签。
- 在网页上右键 → **加入网页集合**，可添加当前页或链接。

## 工具

- **后端同步** — 设置 API 地址并测试连接
- **当前页面** — 复制标题、链接或 Markdown；固定、复制、静音标签页
- **标签页** — 查看当前窗口标签，关闭重复页
- **JSON 格式化** — 格式化、压缩、校验
- **URL 工具** — 解析查询参数、编码、解码
- **时间戳** — Unix 时间与本地时间互转
- **导入导出** — 集合 JSON 备份

## 权限

| 权限 | 用途 |
| --- | --- |
| `sidePanel` | 在 Chrome 侧边栏显示界面 |
| `tabs` | 读取当前标签，并跳转到已打开的标签 |
| `storage` | 在浏览器中保存集合和设置 |
| `contextMenus` | 右键「加入网页集合」 |
| `favicon` | 显示网站图标 |
| `http://*/*`、`https://*/*` | 读取已打开标签的网址，避免重复开页 |
| `localhost` / `127.0.0.1` | 访问 leon_workflow API |

## 目录

```text
manifest.json        Chrome Manifest V3
background.js        侧边栏行为、右键菜单、定位已有标签
sidepanel.html       侧边栏页面
css/sidepanel.css    样式
js/sidepanel.js      集合界面
js/tools.js          工具界面
js/storage.js        浏览器本地存储与增删改
js/api.js            leon_workflow HTTP 客户端
js/sync.js           与后端的推送 / 拉取
js/settings.js       后端地址与存储模式
js/dom.js            DOM 与图标
icons/               扩展图标
scripts/make-icons.py
```

重新生成图标：

```bash
python3 scripts/make-icons.py
```
