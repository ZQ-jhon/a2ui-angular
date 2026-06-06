# a2ui-angular

Angular 19 SSR + [Genkit](https://genkit.dev/) 全栈聊天应用。模型后端使用 **OpenRouter 代理的 Claude**（OpenAI 兼容端点），改造自官方 `genkit-angular-starter-kit`。

核心能力（**a2ui** = Agent-to-UI）：与 Agent 对话时，Agent 不仅能回复文字，还能**动态生成表单**让你填写；填写并提交后，结果即时回执并回喂会话，让对话自然延续。详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

> 注：聊天接口 `/chatFlow` 与表单提交接口 `/submitForm` 都由 `src/server.ts` 的 Express 暴露，必须跑 SSR 服务（`npm run serve:ssr:app`，默认 :8540）才能用；纯 `ng serve`（:4200）dev server 不挂载这两个端点。

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

3. 或构建并以 SSR 生产模式运行（表单等完整能力需要这种方式，因为端点由 SSR 服务端提供）：

   ```bash
   npm run build
   npm run serve:ssr:app   # http://localhost:8540/
   ```

   也可以一键构建并带 Genkit Developer UI 启动：

   ```bash
   npm run start:with-genkit-ui   # 构建后启动 SSR（:8540），同时打开 Genkit 调试 UI
   ```

> **区域限制提示**：Node.js 内置 `fetch`（undici）默认不读 `HTTP_PROXY/HTTPS_PROXY` 环境变量。若你的出口 IP 被 OpenRouter 限制（返回 403 "This model is not available in your region"），在 `.env` 里配置 `HTTPS_PROXY` 指向你的本地代理即可——`src/flows.ts` 会用 undici 的 `ProxyAgent` 显式让请求走代理。

## 📜 可用脚本

| 命令 | 说明 |
|------|------|
| `npm start` | dev server（:4200）——`/chatFlow`、`/submitForm` 在此不可用 |
| `npm run build` | 生产构建，产物在 `dist/app/` |
| `npm run serve:ssr:app` | SSR 生产服务（:8540），提供 `/chatFlow`、`/submitForm` 端点 |
| `npm run start:with-genkit-ui` | 构建并启动 SSR（:8540）+ Genkit Developer UI |
| `npm run typecheck` | 仅做 TypeScript 类型检查（不产出文件） |
| `npm test` | 运行单元测试（Karma） |

## 🏗️ 架构

> 完整架构（含系统图与时序图）见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

- **前端**：Angular 19，独立组件（standalone），Angular Material。聊天界面 `src/app/agent-chat/`，动态表单组件 `src/app/dynamic-form/`，状态与端点调用集中在 `src/app/agent.service.ts`。
- **SSR**：`@angular/ssr` 的 `CommonEngine` + Express（`src/server.ts`）。
- **后端 flow**：Genkit `chatFlow`（对话）与 `submitFlow`（表单提交）定义于 `src/flows.ts`，通过 `@genkit-ai/express` 的 `expressHandler` 暴露为 `POST /chatFlow`、`POST /submitForm`。`src/server.ts` 在首次请求时惰性加载 `flows.ts`。
- **结构化输出**：`chatFlow` 用 zod schema 约束 Genkit 的结构化输出，模型据此可附带一个合法的 `form` 字段（动态表单）。
- **模型**：`@genkit-ai/compat-oai` 接入 OpenRouter（OpenAI 兼容），模型由 `OPENROUTER_MODEL` 配置。

### `/chatFlow` 接口

请求：

```json
POST /chatFlow
{ "data": { "userInput": "我想注册账号", "sessionId": "abc", "clearSession": true } }
```

响应（`options` 与 `form` 均为可选；需要用户填表时才返回 `form`）：

```json
{
  "result": {
    "agentResponse": "请填写以下表单",
    "form": {
      "formId": "register-001",
      "title": "新账号注册",
      "fields": [
        { "name": "username", "label": "用户名", "type": "text", "required": true }
      ],
      "submitLabel": "注册"
    }
  }
}
```

### `/submitForm` 接口

表单提交端点。当前为 **mock**：无论收到什么都返回成功（接真实业务只需替换 `src/flows.ts` 中 `submitFlow` 的函数体）。

请求：

```json
POST /submitForm
{ "data": { "formId": "register-001", "sessionId": "abc", "data": { "username": "alice" } } }
```

响应：

```json
{ "result": { "success": true, "message": "表单「register-001」已提交成功。", "submittedAt": "2026-06-06T..." } }
```
