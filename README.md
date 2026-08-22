# Leon Tools Pro

Chrome 侧边栏扩展：用「集合」按项目收纳网页，用「工具」处理当前标签页和常用文本。

集合数据会同时保存两份：

- 浏览器：`chrome.storage.local`，离线也能读写
- 后端：`leon_workflow` 的 `/api/web-collections`，默认 `http://127.0.0.1:8080`

连不上后端时，扩展仍可用；后端启动后点侧边栏「同步」，会把本地未上传的集合补上去，并拉回服务器上的集合。

## 安装

1. 打开 Chrome，访问 `chrome://extensions`
2. 打开右上角 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择本仓库根目录（包含 `manifest.json` 的文件夹）
5. 点击工具栏上的扩展图标，侧边栏会打开

Chrome 114+ 可用；打开侧边栏和右键加入需要 Chrome 116+。

加载或更新扩展后，Chrome 可能会提示访问 `127.0.0.1` 的权限，需要允许。leon_workflow 后端改动后请重启，再在侧边栏点「同步」。默认地址：`http://127.0.0.1:8080`。

## 使用

### 集合

- 顶部始终显示当前标签页。点 **加入集合**，把当前页放进某个集合和分组。
- 没有集合时，会先让你创建一个，再把当前页加进去。
- 进入集合后可以新建分组、编辑备注、打开单个网页或一次性打开全部。
- 网页右键菜单选择 **加入网页集合**，也可以把当前页或链接加进去。
- 同一集合里重复的网址不会再加一次。

### 工具

- **后端同步**：设置 leon_workflow 地址，测试连接并立即同步
- **当前页面**：复制标题、链接、Markdown，固定 / 复制 / 静音标签页
- **标签页**：查看当前窗口标签，关闭重复页
- **JSON 格式化**：格式化、压缩、校验
- **URL 工具**：解析查询参数、编解码
- **时间戳**：Unix 时间与本地时间互转
- **导入导出**：备份或恢复集合 JSON，导入后会尝试同步到后端

### 快捷键

系统可能把 `Alt+Shift+W` 分配给「打开侧边栏」。若冲突，到 `chrome://extensions/shortcuts` 自行修改。

## 目录

```text
manifest.json        扩展清单（Manifest V3）
background.js        侧边栏行为、右键菜单
sidepanel.html       侧边栏页面
css/sidepanel.css    样式
js/sidepanel.js      集合界面
js/tools.js          工具界面
js/storage.js        浏览器本地数据
js/api.js            leon_workflow HTTP 客户端
js/sync.js           双向同步
js/settings.js       后端地址与同步状态
js/dom.js            DOM 与图标
icons/               扩展图标
```

重新生成图标：

```bash
python3 scripts/make-icons.py
```
