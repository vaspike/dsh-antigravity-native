# Antigravity native ACP

[English](README.md) | 中文

一个把现有 Antigravity CLI 登录接入 DSH 原生模型选择器、工作区、Session 列表和 Chat 的插件。它是只追加消息的 ACP 客户端，不会向 agy 重放 DSH 历史，也不是子 Agent 桥接器。

npm 包：[`dsh-antigravity-native`](https://www.npmjs.com/package/dsh-antigravity-native)

## 从 npm 安装

环境要求：DSH `0.2.2-rc.5`、Node.js `>=22.19`，以及已安装并已完成登录的 Antigravity CLI（`agy`）。

```sh
# DSH Web
dsh plugin --profile web add dsh-antigravity-native

# DSH Desktop
dsh plugin --profile desktop add dsh-antigravity-native
```

也可以通过 DSH 插件管理器安装 `dsh-antigravity-native`。安装后启用插件，新建一个 DSH Session，然后选择 **Antigravity ACP** 模型。

## 使用

1. 如果尚未登录，先在 DSH 之外通过官方 `agy` 完成登录。
2. 安装并启用本插件。
3. 在任意 DSH 工作区中新建 Session，选择 **Antigravity ACP** 模型和思考等级。
4. 直接使用 DSH 原生输入框发送消息，并在原生 Chat 中查看回答。

第一次发送消息时，插件会在当前 DSH Session 的工作目录中创建 agy Session。后续消息会继续使用同一个 agy Session。重启 DSH 或 agy 进程后，插件会通过持久化绑定恢复会话。

## 模型与 Session 边界

- 模型和思考等级来自 agy 的 `configOptions`，插件不硬编码模型目录。
- Antigravity Session 可以在 agy 公布的模型之间切换，但不能切换为 DSH 原生模型。
- DSH 原生 Session 不能切换为 Antigravity。
- 非法的跨体系模型选择会恢复为最近一次的合法选择，并显示原生提示。`agent/pre-step` 会拒绝任何剩余的跨体系请求。
- 绑定后的工作目录不能更改。如需使用其他目录，请新建 DSH Session。
- 已有消息的 DSH Session 不能改用 Antigravity。

## 历史与工具

DSH 保存原生 Chat 所需的消息。Antigravity 独立拥有模型上下文和工具历史。插件只转发新的用户消息，不会把之前的 DSH 历史、系统提示词或 DSH 工具声明发送给 agy。ACP 文本和思考块会转换为普通的 DSH 流式消息块。ACP 工具通知不会重复执行，也不会重复转换为 DSH 工具调用。权限请求使用 DSH 的审批服务，每次最多只允许一个匹配操作。

重复重试、历史编辑、分叉、重生成和 DSH Compaction 都会被拒绝，避免重新执行结果不确定的任务。标题生成使用独立的 agy Utility Session。

## 配置

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `binaryPath` | `agy` | 现有 Antigravity CLI 可执行文件 |
| `discoveryWorkspace` | — | 可选的模型发现与 Utility 请求工作区。未设置时使用 DSH 进程工作目录；普通 agy Session 始终使用对应 DSH Session 的工作区 |
| `sandbox` | `true` | 向 `agy acp` 传递 `--sandbox` |
| `requestTimeoutMs` | `30000` | ACP 初始化和模型配置的超时时间 |
| `stopGraceMs` | `5000` | 终止托管进程前等待 EOF 的宽限时间 |
| `contextWindow` | `110000` | 提供给 DSH 的保守路由元数据 |
| `maxPromptBytes` | `180000` | Utility 请求序列化后的最大字节数 |

## 模型体验

本插件不会向 DSH 原生模型路由添加文本。对于绑定 Antigravity 的 Session，DSH 只向对应的 agy Session 发送新追加的用户消息。Antigravity 自己管理系统提示词、历史、工具、Token 统计和 KV Cache。DSH 保存用于展示的助手正文和思考内容。当前版本无法安全表示两边历史的编辑或压缩。

## 已知限制

- 尚未导入已有 agy Session。
- 绑定 Session 不支持编辑、分叉、重生成和 DSH Compaction。
- 不渲染完整的 ACP 工具卡片、差异、计划和 Artifacts；原生运行状态与助手内容仍然可见。
- 仅支持文本输入，尚未实现附件。
- 模型选择器中的体系过滤通过自动恢复非法选择和执行前拒绝实现，而不是 Core 选择钩子。
- 本集成未获得 Google 或 DeepSeek 的官方认可。个人订阅的使用仍需遵守 Google 当前条款和产品专项说明。

## 验证

```sh
npm install --ignore-scripts
npm run check
node scripts/probe-real.mjs /Users/river/code/agy-acp-test
```

真实探针会消耗 Antigravity 配额，且必须在已经完成登录的 CLI 环境中运行。

## 友情链接

- [V2EX](https://v2ex.com/)
- [Linux.do](https://linux.do/)
- [NodeSeek](https://www.nodeseek.com/)
