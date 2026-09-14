# DevTools AI Assistant — 技术规格文档

> 用自定义 AI 模型替代 Chrome DevTools 内置 AI 辅助面板的 Chrome 扩展

## 1. 背景与动机

### 1.1 问题

Chrome DevTools 内置 AI 辅助功能（Console insights、CSS 解释、Network 请求分析等）存在以下限制：

- **必须登录 Google 账号**才能使用
- **只能使用 Google Gemini**，无法切换为自定义模型（OpenAI / Claude / 本地 Ollama 等）
- **数据发送到 Google 云端**，隐私无法控制
- **地区/网络限制**，部分用户无法访问 Google AI 服务

### 1.2 目标

构建一个 Chrome DevTools 扩展，提供与内置 AI 面板同等甚至更优的调试辅助体验，但：

- 支持任意 OpenAI 兼容的 AI 模型端点（OpenAI / Claude / Ollama / vLLM / 自定义代理）
- 无需登录任何账号，API Key 由用户本地配置
- 数据仅发送到用户指定的端点
- 离线场景可用（本地 Ollama / LM Studio）

### 1.3 非目标

- 不替代 Network / Elements / Console 面板本身
- 不做请求拦截或修改页面行为
- 不做通用的浏览器内 AI 聊天（聚焦 DevTools 调试场景）

---

## 2. 竞品与参考项目分析

### 2.1 搜索结论

在 GitHub 上以 `chrome extension devtools AI`、`devtools network AI explain`、`browser extension ai debug network console` 等关键词搜索，**未发现与本项目定位完全重合的成熟开源项目**。现有项目各覆盖一部分能力，但无项目做到"自定义模型 + 多面板上下文采集 + AI 对话"的完整整合。

### 2.2 相关开源项目

| 项目 | Stars | 定位 | 可借鉴点 |
|------|-------|------|---------|
| [FatMii/sse-devtools-panel](https://github.com/FatMii/sse-devtools-panel) | 17 | SSE/EventSource/NDJSON 流调试面板 | content script 注入架构、bridge 转发模式、虚拟滚动、i18n、TypeScript+pnpm 工程化 |
| [SharvikS/llm-api-inspector](https://github.com/SharvikS/llm-api-inspector) | 0 | 监控页面发出的 LLM API 调用（token/成本/延迟） | 被动监听 `onRequestFinished`（零 host permissions）、纯函数 lib 测试、SSE/NDJSON 解析 |
| [joel-66/ai-dom-context-extractor](https://github.com/joel-66/ai-dom-context-extractor) | 0 | 提取 DOM/CSS 上下文供 LLM 使用 | 选中元素提取、计算样式感知继承、精简 HTML 供 LLM 阅读 |
| [Lengxiao0909/Browser-Agent-Copilot](https://github.com/Lengxiao0909/Browser-Agent-Copilot) | 1 | 网页内 AI Agent（Vue3） | Vue3 扩展工程化 |
| [uncaughterrs/browspark](https://github.com/uncaughterrs/browspark) | 0 | Console+Network+Debugger 的 MCP 调试 | 多源上下文整合思路 |
| [RachelGanonNew/chrome-native-ui-copilot](https://github.com/RachelGanonNew/chrome-native-ui-copilot) | 0 | 用 Gemini Nano 检测/修复 UI 问题 | DevTools 侧边面板集成 |

### 2.3 差异化

本项目与上述项目的核心差异：

| 维度 | 现有项目 | 本项目 |
|------|---------|--------|
| 模型来源 | 固定（Gemini Nano / 无 AI） | 用户自定义任意 OpenAI 兼容端点 |
| 上下文范围 | 单一面（仅 SSE / 仅 DOM / 仅 LLM 调用） | Network + Console + DOM/CSS + Performance 多源整合 |
| 交互方式 | 多为单向提取/监控 | 双向对话式（用户提问 → AI 分析） |
| 流式输出 | 无 | SSE 流式渲染到面板 |

---

## 3. 功能规格

### 3.1 核心功能

#### F1: 自定义 DevTools 面板

- 在 DevTools 中创建顶级面板 "AI Assistant"
- 面板内包含：上下文选择栏 + AI 对话区 + 输入框

#### F2: Network 上下文采集

- 监听 `chrome.devtools.network.onRequestFinished`，被动采集请求
- 支持获取响应体（`request.getContent()`）
- 采集字段：URL、Method、Status、MIME、请求头、响应头、响应体（截断）
- 支持筛选：错误请求（4xx/5xx）、慢请求（>1s）、XHR/Fetch
- 一键将选中请求作为 AI 上下文

#### F3: Console 上下文采集

- 通过 `chrome.devtools.inspectedWindow.eval()` 注入 console 劫持脚本
- 采集 `console.log/error/warn/info/debug` 消息
- 支持筛选：仅 error/warn、关键词搜索
- 一键将选中日志作为 AI 上下文

#### F4: DOM/CSS 上下文采集

- 监听 `chrome.devtools.panels.elements.onSelectionChanged`，获取当前选中元素
- 通过 `inspectedWindow.eval("$0.outerHTML")` 获取选中元素 HTML
- 获取计算样式（computed styles），感知继承
- 精简输出：剥离冗余属性，控制 token 用量

#### F5: AI 对话与流式输出

- 用户在输入框提问，面板将选中的上下文 + 问题组装为 prompt
- 通过 background service worker 调用用户配置的 AI 端点
- SSE 流式输出，逐 chunk 渲染 Markdown 到对话区
- 支持多轮对话（保留上下文）

#### F6: 模型配置

- 独立 Options 页面配置：
  - API Endpoint URL
  - API Key（可选，本地 Ollama 无需）
  - 模型名称
  - 系统提示词（可选自定义）
  - 温度等参数
- 配置存储于 `chrome.storage.sync`（跨设备同步）

### 3.2 扩展功能（后续迭代）

- F7: Performance 面板洞察采集
- F8: 预设 Prompt 模板（"解释这个 500 错误"、"分析这段 CSS 布局问题"等）
- F9: 对话历史持久化
- F10: 上下文 token 用量预览与截断策略
- F11: 多模型切换（配置多个 profile，面板内快速切换）

---

## 4. 技术架构

### 4.1 整体架构

```
┌─────────────────────────────────────────────────────────┐
│  Chrome DevTools                                        │
│                                                         │
│  ┌───────────────────────────────────────────┐          │
│  │  AI Assistant Panel (panel.html)          │          │
│  │                                           │          │
│  │  ┌─────────┐  ┌────────────────────┐     │          │
│  │  │ Context │  │  Conversation      │     │          │
│  │  │ Picker  │  │  (stream Markdown) │     │          │
│  │  └────┬────┘  └─────────▲──────────┘   │          │
│  │       │                 │               │          │
│  │       ▼                 │               │          │
│  │  ┌──────────────────────┴──────────┐    │          │
│  │  │  panel.js                       │    │          │
│  │  │  - context collectors            │    │          │
│  │  │  - prompt assembler              │    │          │
│  │  │  - chrome.runtime.connect (Port) │    │          │
│  │  └──────────────┬──────────────────┘    │          │
│  └─────────────────┼───────────────────────┘          │
│                    │                                   │
├────────────────────┼───────────────────────────────────┤
│  Extension Process │                                   │
│                    ▼                                   │
│  ┌──────────────────────────────────────────┐           │
│  │  background.js (Service Worker)           │           │
│  │                                          │           │
│  │  - Port listener (long-lived connection) │           │
│  │  - read config from storage              │           │
│  │  - fetch() → custom AI endpoint          │           │
│  │  - SSE stream → forward chunks via Port  │           │
│  └──────────────┬───────────────────────────┘           │
│                 │                                       │
└─────────────────┼───────────────────────────────────────┘
                  ▼
         ┌─────────────────┐
         │ Custom AI Model  │
         │ OpenAI / Claude │
         │ / Ollama / etc.  │
         └─────────────────┘
```

### 4.2 通信机制

| 通信路径 | 机制 | 说明 |
|---------|------|------|
| Panel → Background | `chrome.runtime.connect()` Port | 长连接，支持双向流式消息（AI 回复逐 chunk 推回） |
| Panel → 被检查页面 | `chrome.devtools.inspectedWindow.eval()` | 在页面上下文执行 JS，获取 DOM/Console/CSS |
| Background → AI 端点 | `fetch()` + ReadableStream | SSE 流式读取，通过 Port 转发给 Panel |
| Background → Storage | `chrome.storage.sync` | 读取/保存用户配置 |

### 4.3 流式通信流程

```
panel.js                         background.js                    AI Endpoint
    │                                  │                              │
    │── Port: { action:"ask", ctx, q } ──▶                            │
    │                                  │── POST /chat/completions ▶──▶│
    │                                  │◀── SSE: data: {chunk1} ──────│
    │◀── Port: { chunk: chunk1 } ──────│                              │
    │                                  │◀── SSE: data: {chunk2} ──────│
    │◀── Port: { chunk: chunk2 } ──────│                              │
    │                                  │◀── SSE: data: [DONE] ────────│
    │◀── Port: { done: true } ─────────│                              │
```

---

## 5. DevTools API 使用计划

| 需求 | API | 用法 |
|------|-----|------|
| 创建面板 | `chrome.devtools.panels.create(title, icon, page, cb)` | 注册顶级 DevTools 面板 |
| 监听元素选中 | `chrome.devtools.panels.elements.onSelectionChanged` | 获取当前选中的 DOM 元素 |
| 获取选中元素 | `chrome.devtools.inspectedWindow.eval("$0 ...")` | 取选中元素的 HTML/样式 |
| 监听网络请求 | `chrome.devtools.network.onRequestFinished.addListener(cb)` | 被动采集请求（零 host 权限） |
| 获取全量 HAR | `chrome.devtools.network.getHAR()` | 一次性获取所有请求快照 |
| 获取响应体 | `request.getContent(cb)` | 从 HAR entry 获取响应内容 |
| 页面上下文执行 | `chrome.devtools.inspectedWindow.eval(expr)` | 注入 console 劫持、提取 DOM/CSS |
| 重载注入脚本 | `chrome.devtools.inspectedWindow.reload({injectedScript})` | 页面重载时注入 console 劫持 |
| 配置存储 | `chrome.storage.sync.get/set()` | 存储模型配置 |
| 扩展消息 | `chrome.runtime.connect()` / `onConnect` | Panel 与 Background 的长连接 |

### 权限最小化

参考 llm-api-inspector 的做法，核心功能仅需：

```json
{
  "permissions": ["storage"],
  "host_permissions": ["<all_urls>"]
}
```

- `storage`：存储模型配置
- `host_permissions: ["<all_urls>"]`：让 background service worker 能 fetch 任意 AI 端点
- **不需要** content_scripts（通过 `inspectedWindow.eval` 注入）
- **不需要** debugger 权限（通过 `onRequestFinished` 被动监听）

---

## 6. 文件结构

```
devtools-ai-assistant/
├── SPEC.md                     # 本文档
├── manifest.json               # MV3 扩展清单
├── package.json                # 构建工具配置
├── tsconfig.json               # TypeScript 配置
│
├── src/
│   ├── devtools/
│   │   ├── devtools.html       # DevTools 入口页（隐藏）
│   │   └── devtools.ts         # 注册面板
│   │
│   ├── panel/
│   │   ├── panel.html          # AI 面板 UI
│   │   ├── panel.ts            # 面板主逻辑
│   │   ├── panel.css           # 面板样式
│   │   │
│   │   ├── collectors/         # 上下文采集器
│   │   │   ├── network.ts      # Network 请求采集
│   │   │   ├── console.ts      # Console 日志采集
│   │   │   └── dom.ts          # DOM/CSS 采集
│   │   │
│   │   ├── components/         # UI 组件
│   │   │   ├── context-picker.ts   # 上下文选择栏
│   │   │   ├── conversation.ts     # 对话渲染区
│   │   │   ├── input-bar.ts        # 输入框
│   │   │   └── markdown-viewer.ts # Markdown 渲染
│   │   │
│   │   └── lib/
│   │       ├── prompt-builder.ts   # Prompt 组装
│   │       └── port-client.ts      # Background 通信客户端
│   │
│   ├── background/
│   │   └── background.ts      # Service Worker
│   │
│   ├── options/
│   │   ├── options.html       # 模型配置页
│   │   └── options.ts         # 配置页逻辑
│   │
│   └── shared/
│       ├── types.ts           # 共享类型定义
│       ├── config.ts          # 配置读写
│       └── constants.ts       # 常量
│
├── icons/
│   ├── icon16.png
│   └── icon48.png
│
└── test/
    └── prompt-builder.test.ts  # 单元测试
```

---

## 7. 关键技术决策

### 7.1 流式通信：Port vs sendMessage

**决策**：使用 `chrome.runtime.connect()` Port 长连接

**原因**：
- `sendMessage` 是一次性的，AI 流式输出需要多次推送 chunk
- Port 是长连接，适合持续的双向流式通信
- Service Worker 可能在长请求中被回收，Port 保持的连接有助于保活

### 7.2 Console 采集：注入劫持

**决策**：通过 `inspectedWindow.eval()` 注入 console 方法劫持

**原因**：
- DevTools 扩展没有直接读取 Console 面板消息的 API
- 注入劫持 `console.log/error/warn` 等方法，将消息存入 `window.__aiConsoleLog`
- 通过 `inspectedWindow.reload({injectedScript: '...'})` 在页面加载前注入，确保捕获全部日志

**替代方案**：Chrome DevTools Protocol 的 `Runtime.consoleAPICalled` 事件，但扩展中不易直接使用 CDP。

### 7.3 Network 采集：被动监听

**决策**：使用 `onRequestFinished` 被动监听，不做请求拦截

**原因**（参考 llm-api-inspector）：
- 零 host permissions 需求（`onRequestFinished` 是 DevTools 自身的 HAR 源）
- 不改变页面行为，无副作用
- 与 Network 面板展示一致

### 7.4 UI 框架

**决策**：原生 TypeScript + 轻量 DOM 操作，不用 React/Vue

**原因**：
- DevTools 面板环境受限，避免重型框架的打包体积和 CSP 限制
- 参考项目 sse-devtools-panel 虽然用了 TypeScript 但 UI 也是手写
- Markdown 渲染用 `marked` + DOMPurify（轻量库）

### 7.5 构建工具

**决策**：esbuild 打包（或 Vite）

**原因**：
- 极快的构建速度
- 对 Chrome 扩展 MV3 支持良好
- sse-devtools-panel 用 Vite + pnpm 可作为参考

### 7.6 Service Worker 保活

**问题**：MV3 Service Worker 会在 30s 无活动后被回收，长流式 AI 请求可能中断

**对策**：
- Port 连接本身会保活 Service Worker
- 额外用 `chrome.alarms`（每 25s 触发一次）保活作为兜底
- 流式 chunk 持续到达也会重置计时器

---

## 8. 数据流与 Prompt 组装

### 8.1 Prompt 模板

```
[System]
You are a DevTools AI assistant. Analyze the provided debugging context
and answer the user's question concisely with code examples where relevant.

[Context]
## Page
- URL: {pageUrl}
- Title: {pageTitle}

## Network Requests
{selectedRequests or "not selected"}

## Console Messages
{selectedConsoleLogs or "not selected"}

## DOM / CSS
{selectedDomOrCss or "not selected"}

[User]
{userQuestion}
```

### 8.2 上下文截断策略

| 上下文类型 | 截断策略 | 最大 token 估算 |
|-----------|---------|---------------|
| Network 请求 | 每个请求 URL+Method+Status+Headers，响应体截断 2000 字符 | ~1500 tokens/请求 |
| Console 日志 | 每条消息截断 500 字符，最多 20 条 | ~2000 tokens |
| DOM HTML | 选中元素 outerHTML 截断 5000 字符 | ~1500 tokens |
| CSS 计算样式 | 仅非默认值属性，截断 2000 字符 | ~800 tokens |

总上下文目标：控制在 8000 tokens 以内，为用户问题和 AI 回复预留空间。

---

## 9. 开发计划

### Phase 1: MVP（最小可用）

- [ ] manifest.json + 基础项目脚手架
- [ ] devtools.html/ts 注册面板
- [ ] panel.html 基础 UI（上下文选择 + 对话区 + 输入框）
- [ ] Network 上下文采集器（onRequestFinished + getContent）
- [ ] background.ts：Port 通信 + fetch AI 端点 + SSE 流式
- [ ] options.html/ts：模型配置页
- [ ] Markdown 渲染（marked + DOMPurify）

### Phase 2: 上下文扩展

- [ ] Console 日志采集器（注入劫持）
- [ ] DOM/CSS 采集器（onSelectionChanged + eval）
- [ ] 上下文截断策略实现
- [ ] 上下文 token 预览

### Phase 3: 体验优化

- [ ] 流式输出优化（光标动画、自动滚动）
- [ ] 对话历史（多轮上下文）
- [ ] 预设 Prompt 模板
- [ ] 暗色主题（跟随 DevTools 主题）
- [ ] Service Worker 保活机制

### Phase 4: 高级功能

- [ ] 多模型 Profile 切换
- [ ] 对话历史持久化（chrome.storage.local）
- [ ] Performance 洞察采集
- [ ] 导出对话 / 上下文
- [ ] Chrome Web Store 发布

---

## 10. manifest.json 规格

```json
{
  "manifest_version": 3,
  "name": "DevTools AI Assistant",
  "version": "0.1.0",
  "description": "Custom AI assistant for Chrome DevTools — use your own model to debug Network, Console, and CSS.",
  "devtools_page": "src/devtools/devtools.html",
  "permissions": ["storage"],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "src/background/background.js",
    "type": "module"
  },
  "options_page": "src/options/options.html",
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png"
  }
}
```

---

## 11. 风险与限制

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| MV3 Service Worker 回收导致流式中断 | AI 回复不完整 | Port 保活 + chrome.alarms 兜底 |
| Console 劫持注入时机晚于页面脚本 | 漏掉早期日志 | 用 `reload({injectedScript})` 在加载前注入 |
| `getContent()` 对某些响应不可用 | 无法获取响应体 | 降级显示 "body unavailable"，仍可分析 headers |
| DevTools 面板 CSP 限制 | 无法加载外部脚本 | 所有依赖打包进扩展，不用 CDN |
| 上下文过长超出模型窗口 | AI 回复质量下降 | 截断策略 + token 预览 |
| 非 Chromium 浏览器不支持 | Firefox/Safari 不可用 | 明确仅支持 Chromium 内核 |
