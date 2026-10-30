# Leon Tools Pro

Chrome 侧边栏扩展：按项目收纳网页，并在当前标签旁使用便签、待办、LLM 和一组小工具。

需要 [leon_workflow](../leon_workflow) 后端。业务数据写入后端，浏览器保留显示缓存；后端不可用时不能修改数据。旧版未同步数据会在连接后尝试迁移。

[English documentation](README.md)

## 功能概览

侧边栏五个 Tab：**集合**、**工具**、**便签**、**待办**、**LLM**。底部是设置。

| 模块 | 能力 |
| --- | --- |
| 集合 | 网页分组收藏、拖动排序、集合图标、打开已有标签而不重复开页 |
| 工具 | 「我的工具」书签箱 + JSON / URL / 时间戳等内置工具 |
| 便签 | 类似聊天的便签流，保存到后端 |
| 待办 | 清单、完成状态，输入框在底部 |
| LLM | DeepSeek 多会话对话；便签/待办可一键 AI 分析 |

删除操作都有二次确认。集合卡片和工具卡片不展示 URL，只显示标题（和图标）。

## 环境要求

- Chrome 116+（侧边栏）
- 必需：[leon_workflow](../leon_workflow)，默认 `http://127.0.0.1:8080`

## 安装

1. 打开 `chrome://extensions`
2. 打开 **开发者模式**
3. **加载已解压的扩展程序**，选中包含 `manifest.json` 的目录
4. 点工具栏图标打开侧边栏

加载或更新后，请允许访问网站和 `127.0.0.1`，否则无法定位已打开的标签，也无法写后端。

建议快捷键 `Alt+Shift+W`。冲突时到 `chrome://extensions/shortcuts` 修改。

## 设置

侧边栏最下方 **设置**：

| 项 | 说明 |
| --- | --- |
| 后端地址 | 默认 `http://127.0.0.1:8080` |
| DeepSeek API Key | 写入浏览器；后端能连上时同时写入 `app_setting.DEEPSEEK_API_KEY` |
| 飞书 Webhook URL | 自定义机器人地址，如 `https://open.feishu.cn/open-apis/bot/v2/hook/...` |
| 飞书签名密钥 | 机器人开启「签名校验」时填写；未开启可留空 |

集合、便签、待办、工具箱和对话的新增或修改需要后端可用。浏览器缓存用于展示和迁移旧数据。

后端代码变更后请重启 leon_workflow（JPA `ddl-auto=update` 会补字段和表）。

## 集合

- 把当前标签加入集合；还没有集合时会先创建再加入。
- 新建 / 编辑集合可选择图标（与工具箱同一套默认图标）；不选则仍显示彩色圆点。
- 同一集合里相同网址不会重复添加。
- 面包屑：`集合列表` / `{集合名称}`。
- 拖动六点手柄调整集合、分组、网页顺序；网页可拖到其他分组。顺序写入后端 `sort_order`。
- 点击已保存网页：已有标签则跳转，否则新开。
- 网页卡片只显示标题（有备注则显示备注），不显示网址。
- 右键页面或链接 → **加入网页集合**。

## 工具

顶部可把当前页加入 **我的工具**（工具箱，不是集合）。工具卡可自定义图标，不展示 URL。

内置工具：

- **后端同步** — 地址与连接状态
- **当前页面** — 复制标题 / 链接 / Markdown；固定、复制、静音标签
- **标签页** — 当前窗口标签列表，关闭重复页
- **JSON 格式化** — 格式化、压缩、校验
- **URL 工具** — 解析查询参数、编解码
- **时间戳** — Unix 时间与本地时间
- **导入导出** — 集合 JSON 备份（不含便签 / 待办 / 对话）

## 便签

- 底部输入，回车发送，记录持久化到后端 `/api/notes`。
- **未归档 / 已归档** 两个 Tab。未归档可编辑、归档；已归档可取消归档、删除。未归档不能删除。
- 右上角 **AI分析**：只把未归档便签和待办发给 LLM，分析工作并给效率建议。回复第一行是 `TL;DR：`，结果也会存进 LLM 会话「工作分析」。
- 新增便签时，若已配置飞书 Webhook，会向群里推一张「新增便签」卡片。

## 待办

- 底部输入框与发送图标（与便签一致）。
- 勾选完成、编辑、删除；数据写入后端 `/api/todos`。
- 同样有 **AI分析**（分析便签 + 待办）。
- 新增、勾完成时会发飞书卡片（「新增待办」「完成待办」）。

后端定时（时区 `Asia/Shanghai`，需 leon_workflow 一直在跑，且库里已有 Webhook）：

| 时间 | 内容 |
| --- | --- |
| 每天 10:00、14:00、20:00 | 待办统计卡片（全部 / 未完成 / 已完成列表），不经过 LLM |
| 每天 00:00（24 点） | 待办日结：先用 DeepSeek 总结（开头 `TL;DR：`），再发飞书；LLM 失败则改发原始统计 |

手动触发：

```bash
curl -X POST http://127.0.0.1:8080/api/todo-digest/stats
curl -X POST http://127.0.0.1:8080/api/todo-digest/summary
```

## LLM

- 模型：`deepseek-v4-flash`，关闭思考。
- **新建** / **历史** / 点选加载会话。第一条用户消息会当作会话标题。
- 每次请求只带**同一会话里当前问题之前最近 5 条用户问题**作上下文，不含助手回复。
- 会话保存在后端 `/api/llm-sessions`。

## 飞书通知

使用[自定义机器人 Webhook](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot)。消息为带彩色表头的卡片（`msg_type: interactive`）。

| 事件 | 表头 | 颜色 |
| --- | --- | --- |
| 新增便签 | 新增便签 | 蓝 |
| 新增待办 | 新增待办 | 橙 |
| 完成待办 | 完成待办 | 绿 |
| 定时统计 / 日结 | 待办统计 / 待办日结 | 蓝 / 紫 |

若机器人开了「自定义关键词」，标题里已包含「便签」「待办」。签名校验请把密钥填进设置。

## 权限

| 权限 | 用途 |
| --- | --- |
| `sidePanel` | 侧边栏界面 |
| `tabs` | 读取当前标签，跳转到已打开标签 |
| `storage` | 本地保存数据与设置 |
| `contextMenus` | 右键加入集合 |
| `favicon` | 网站图标 |
| `http://*/*`、`https://*/*` | 读取标签 URL、调用 DeepSeek / 飞书 |
| `localhost` / `127.0.0.1` | leon_workflow API |

## 测试

扩展纯函数单测（Node）：

```bash
npm test
node --test --experimental-test-coverage test/*.test.js
```

后端（含便签、待办、LLM、飞书、定时日结等）：

```bash
cd ../leon_workflow && mvn test
```

覆盖率报告：`../leon_workflow/target/site/jacoco/index.html`

## 目录

```text
manifest.json          Chrome Manifest V3
background.js          侧边栏、右键菜单、定位已有标签
sidepanel.html         侧边栏页面
css/sidepanel.css      样式
js/sidepanel.js        集合 / 设置 / 工具箱编辑
js/storage.js          集合操作与显示缓存
js/api.js              leon_workflow HTTP 客户端
js/sync.js             集合刷新与旧数据迁移
js/settings.js         后端地址、存储模式、DeepSeek / 飞书配置
js/persist.js          本地脏数据和后端列表合并
js/icon-picker.js      集合 / 工具图标选择器
js/notes.js            便签
js/todos.js            待办
js/llm.js              LLM 会话与 DeepSeek
js/work-analysis.js    便签 / 待办 AI 分析
js/feishu.js           飞书卡片通知
js/toolbox.js          我的工具
js/tools.js            内置工具
js/dom.js              DOM 与图标
js/tool-icons.js       默认可选图标
test/                  扩展单元测试
icons/
scripts/make-icons.py
```

重新生成图标：

```bash
python3 scripts/make-icons.py
```
