# DevTools AI Assistant

由**你自己的模型端点**驱动的 Chrome DevTools 面板。用 AI 助手分析网络请求、控制台报错和 DOM——不需要谷歌账号、不需要 Gemini 订阅，支持任意 OpenAI 兼容 API（包括本地 Ollama）。

## 功能

- **流式对话面板**：独立的 `AI Assistant` DevTools 标签页
- **丰富的上下文注入**：网络请求（自动去重、过滤静态资源）、控制台错误（与页面内浮层捕获合并）、页面/DOM 信息、`Inspect` 选中元素
- **双击任意 Network 行**即可向 AI 提问该请求——完整请求头、请求体、响应体一并附上（prompt 中的 `Focused Request` 段），200 响应同样适用
- **Elements 侧边栏面板**：失败请求 / 控制台错误 / 选中元素 一键提问
- **页面错误浮层**（content script，Shadow DOM）：DevTools 打开时实时捕获运行时错误并解析真实源码位置，支持 `Ask AI` 和 `Jump to Source`
- **JWT 过期哨兵**：自动解码 `Authorization: Bearer` 令牌，显示剩余有效期，一键复制
- **分析工具集**（本地预分析 + AI 解读）：

  | 工具 | 作用 |
  |------|------|
  | 响应 Diff | 同一接口两次调用的字段级 JSON 差异——第一时间发现后端偷偷改 schema |
  | 敏感扫描 | 正则扫描 URL/头/响应体中的 AWS 密钥、私钥、JWT、内网 IP、手机号/身份证/邮箱泄露 |
  | 认证审计 | 列出未携带 `Authorization` 头的接口 |
  | 安全响应头 | CSP / HSTS / X-Frame-Options / X-Content-Type-Options 缺失检测 |
  | 攻击面枚举 | 将观测到的路径归一化为模式（`{id}`、`{uuid}`），枚举方法与查询参数 |
  | 性能瀑布 | 基于 HAR timings：慢请求、高 TTFB、串行阻塞链路 |
  | Mock 生成 | 拿真实 JSON 响应让模型生成边界测试变体数据 |

- 每个代码块带复制按钮、流式期间可 Stop 中断、中文输入法安全

## 安装

**从 Release 下载（无需任何工具链）**：到 [最新 Release](../../releases) 下载 `devtools-ai-assistant-X.Y.Z.zip`，解压后打开 `chrome://extensions`，开启右上角**开发者模式**，点击**加载已解压的扩展程序**并选择解压出的 `devtools-ai-assistant-X.Y.Z` 文件夹。

**从源码构建**：

```bash
pnpm install
pnpm build        # 或 node build.mjs
```

同样在 `chrome://extensions` 以开发者模式**加载已解压的扩展程序**，选择 **`dist/`** 目录（不是仓库根目录）。

开发模式热更新：`pnpm dev`（esbuild watch）。

## 配置

打开扩展的 Options 页面（或面板里的设置入口），填写：

- **API Endpoint** —— 任意 OpenAI 兼容的 `/chat/completions` 地址，默认提示：`http://localhost:11434/v1/chat/completions`（Ollama）
- **API Key** —— 保存在 `chrome.storage.local`（不同步、不入库、不进 git）
- **模型名**、可选的**系统提示词**和**温度**

先用 **Test Connection** 验证连通再开始对话。

## 隐私

扩展完全本地运行；除推理请求本身外不发往任何地方，而推理请求**只发往你配置的端点**。上下文载荷会包含 URL、请求/响应头，以及（错误请求或双击聚焦时）响应体——请据此评估端点风险：远程端点会看到 AI 能读到的所有内容，包括敏感扫描命中的样本。追求完全隐私请指向本地模型。

> **仅限授权安全测试。** 攻击面枚举 / 认证审计功能只能用于你自己拥有或获得明确书面授权测试的系统。

## 项目结构

```
src/
  shared/      类型、常量、配置读写
  devtools/    DevTools 页：面板/侧边栏注册、网络监听、
               双击拦截（setOpenResourceHandler）、
               DevTools 打开状态探测（供浮层使用）
  panel/       对话 UI、上下文采集器、分析工具
    collectors/network.ts   请求存储（live + HAR 回填、响应体缓存）
    analysis/               diff / jwt / security / attack-surface / waterfall
  background/  MV3 Service Worker：Port 处理、prompt 组装、
               向 OpenAI 兼容端点流式转发
  options/     设置页
  content/     页面错误浮层（MAIN world + bridge）
  sidebar/     Elements 侧边栏快捷提问
```

## 开发笔记

- `pnpm typecheck` / `pnpm build` / `pnpm dev`
- DevTools 页面历史上不接受 `type="module"` 脚本；构建产物为 classic script，顶层变量名不能遮蔽全局对象（如 `history`）
- DevTools 页（`devtools.html`）随 F12 即加载，面板则懒加载——需要跨页传递且可能"面板还没打开"的消息，由 DevTools 页排队转发
- 发版：`git tag vX.Y.Z && git push origin vX.Y.Z`，Actions 自动构建并上传 zip 到 GitHub Release

## 许可

MIT
