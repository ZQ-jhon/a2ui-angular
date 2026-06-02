# a2ui-angular

Angular 19 SSR + [Genkit](https://genkit.dev/) 全栈聊天应用。模型后端使用 **OpenRouter 代理的 Claude**（OpenAI 兼容端点），改造自官方 `genkit-angular-starter-kit`。

## ✨ 快速预览（无需任何 API Key）

如果你只想看看应用长什么样、体验完整的聊天交互，**不需要购买或配置任何大模型 API Key**，直接：

```bash
npm install
npm run mock
```

然后打开 `http://localhost:4000/`。

`npm run mock` 会先 `ng build`，再以 **Mock 模式** 启动完整的 SSR/Express 服务（含 `POST /chatFlow` 端点）—— 服务端用本地规则模拟回复（包括复刻 `getDateTime` 工具返回真实时间、带选项气泡的结构化回复、多轮会话、注册/登录等热点表单模板），接口与返回结构和真实模式完全一致，所以前端 UI、加载动画、选项交互都能正常体验。Mock 模式下不会发起任何外部网络请求。

> 注：聊天接口 `/chatFlow` 由 `src/server.ts` 的 Express 暴露，必须跑 SSR 服务才能用；纯 `ng serve` dev server 不挂载该端点。如需 dev server 的热重载体验，可用 `npm run mock:dev`，但 `/chatFlow` 在其下不可用（仅供前端调试）。

试着问它：`你好`、`What time is it?`、`你能做什么？`、`讲个笑话`、`我要注册`。

## 🚀 使用真实的 Claude（需要 OpenRouter API Key）

1. 复制环境变量模板并填写：

   ```bash
   cp .env.example .env
   ```

   在 `.env` 中至少填入：

   ```ini
   OPENROUTER_API_KEY=sk-or-...        # 必填:你的 OpenRouter Key
   OPENROUTER_MODEL=anthropic/claude-opus-4.8   # 可选,默认即此
   # 若你所在区域被 OpenRouter 限制,可配置本机代理让 Node fetch 走代理出网:
   # HTTPS_PROXY=http://127.0.0.1:7890
   ```

2. 启动开发服务器：

   ```bash
   npm start          # http://localhost:4200/
   ```

3. 或构建并以 SSR 生产模式运行：

   ```bash
   npm run build
   npm run serve:ssr:app   # http://localhost:4000/
   ```

> **区域限制提示**：Node.js 内置 `fetch`（undici）默认不读 `HTTP_PROXY/HTTPS_PROXY` 环境变量。若你的出口 IP 被 OpenRouter 限制（返回 403 "This model is not available in your region"），在 `.env` 里配置 `HTTPS_PROXY` 指向你的本地代理即可——`src/flows.ts` 会用 undici 的 `ProxyAgent` 显式让请求走代理。

## 📜 可用脚本

| 命令 | 说明 |
|------|------|
| `npm run mock` | **Mock 模式**（先 `ng build` 再跑 SSR，:4000）——无需 API Key，本地模拟回复，`/chatFlow` 可用 |
| `npm run mock:ssr` | 同 `npm run mock` 但不重新构建（需先 `npm run build`，:4000） |
| `npm run mock:dev` | Mock 模式 dev server（:4200，热重载）——仅前端调试，`/chatFlow` 不可用 |
| `npm start` | 真实模式 dev server（:4200）——需 `.env` 中的 OpenRouter Key |
| `npm run build` | 生产构建,产物在 `dist/app/` |
| `npm run serve:ssr:app` | 真实模式 SSR 生产服务（:4000） |
| `npm test` | 运行单元测试（Karma） |

## 🏗️ 架构

- **前端**：Angular 19，独立组件（standalone），Angular Material，聊天界面 `src/app/agent-chat/`。
- **SSR**：`@angular/ssr` 的 `CommonEngine` + Express（`src/server.ts`）。
- **后端 flow**：Genkit `chatFlow`（`src/flows.ts`），通过 `@genkit-ai/express` 的 `expressHandler` 暴露为 `POST /chatFlow`。
- **Mock**：`src/flows.mock.ts` —— 与真实 `chatFlow` 同 schema、同返回结构的纯本地实现。`src/server.ts` 在首次请求时根据 `MOCK_LLM` 环境变量惰性选择加载真实或 Mock flow。
- **模型**：`@genkit-ai/compat-oai` 接入 OpenRouter（OpenAI 兼容），模型由 `OPENROUTER_MODEL` 配置。

### `/chatFlow` 接口

请求：

```json
POST /chatFlow
{ "data": { "userInput": "你好", "sessionId": "abc", "clearSession": true } }
```

响应：

```json
{ "result": { "agentResponse": "...", "options": ["...", "..."] } }
```

真实模式与 Mock 模式的请求/响应结构完全一致。
