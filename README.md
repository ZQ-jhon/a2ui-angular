# a2ui-angular

Angular 19 SSR + [Genkit](https://genkit.dev/) 全栈聊天应用。模型后端使用 **OpenRouter 代理的 Claude**（OpenAI 兼容端点），改造自官方 `genkit-angular-starter-kit`。

> 注：聊天接口 `/chatFlow` 由 `src/server.ts` 的 Express 暴露，必须跑 SSR 服务（`npm run serve:ssr:app`，:4000）才能用；纯 `ng serve`（:4200）dev server 不挂载该端点。

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
| `npm start` | dev server（:4200）——需 `.env` 中的 OpenRouter Key，`/chatFlow` 在此不可用 |
| `npm run build` | 生产构建,产物在 `dist/app/` |
| `npm run serve:ssr:app` | 真实模式 SSR 生产服务（:4000） |
| `npm test` | 运行单元测试（Karma） |

## 🏗️ 架构

- **前端**：Angular 19，独立组件（standalone），Angular Material，聊天界面 `src/app/agent-chat/`。
- **SSR**：`@angular/ssr` 的 `CommonEngine` + Express（`src/server.ts`）。
- **后端 flow**：Genkit `chatFlow`（`src/flows.ts`），通过 `@genkit-ai/express` 的 `expressHandler` 暴露为 `POST /chatFlow`。`src/server.ts` 在首次请求时惰性加载 `flows.ts`。
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
