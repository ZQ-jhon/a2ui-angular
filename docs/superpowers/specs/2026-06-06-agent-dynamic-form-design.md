# Agent 动态生成表单（a2ui MVP）设计

日期：2026-06-06
状态：待实现

## 目标

让 `chatFlow` 的 Agent 在对话中不仅能返回文字，还能返回一个**表单**让用户填写；用户填写并提交后，数据经由一个独立的提交端点处理，成功结果既即时呈现给用户、又回喂 Agent 让对话延续。这是项目名 "a2ui"（Agent-to-UI）的核心能力的最小可用实现。

## 范围

- **包含**：动态表单 schema 定义、`chatFlow` 输出扩展、新增 `/submitForm` mock 端点、前端动态表单组件、提交后的双路闭环（即时回执 + 回喂会话）。
- **不包含**：真实业务落库 / 外部 API（`/submitForm` 是永远返回成功的 mock）、表单数据持久化、多表单并发管理、富字段类型（日期 / 单选组 / 文件上传等，留待后续迭代）。

## 关键决策（来自需求澄清）

1. **表单由 Agent 完全动态生成**——LLM 根据对话上下文自由决定字段，而非后端预制模板选择。
2. **输出形态：文字 + 可选 `form` 字段**——向后兼容，现有文字气泡与 `options` 快捷选项链路完全不变。
3. **字段类型精简核心集**——`text` / `textarea` / `number` / `select` / `checkbox`。
4. **提交走独立端点 `/submitForm`**——边界清晰，背后是永远成功的 mock。
5. **提交后双路闭环（方案 C）**——前端即时显示成功回执气泡，同时带同一个 `sessionId` 回喂 `chatFlow` 续聊。
6. **模型用 Genkit 结构化输出强约束（方案 B）**——把含 `form` 的完整输出写进 zod `outputSchema`，由 Genkit 强制；退役现有 `partial-json` 手动 `parse` + `maybeStripMarkdown`，从源头杜绝脏 schema。

## 数据结构（后端新增 zod schema，位于 `src/flows.ts`）

```
FormField = {
  name: string                                              // 提交时的 key
  label: string                                             // 显示名
  type: 'text' | 'textarea' | 'number' | 'select' | 'checkbox'
  required: boolean
  options?: string[]                                        // 仅 type === 'select' 时使用
  placeholder?: string
}

FormSpec = {
  formId: string        // 本次表单实例 id（模型生成），提交时回指
  title: string
  fields: FormField[]
  submitLabel?: string  // 默认 "提交"
}
```

## chatFlow 输出扩展（向后兼容）

`outputSchema` 由 `{ agentResponse: string, options?: string[] }` 扩展为：

```
{
  agentResponse: string
  options?: string[]
  form?: FormSpec        // 可选；模型需要用户填表时才输出
}
```

- 改用 Genkit 结构化输出：将上述结构作为 `outputSchema`，并以 structured output 方式调用（`chat.send({ prompt, output: { schema } })` 形式），直接拿到已校验对象。
- 退役 `partial-json` 的 `parse(maybeStripMarkdown(text))` 手动解析路径。
- prompt 扩写：说明「何时应该输出 `form`」「`form` 字段含义与 `type` 取值范围」，并强调 `select` 必须带 `options`。

## 新端点 submitFlow（`/submitForm`）

```
输入: { formId: string, sessionId: string, data: Record<string, unknown> }
输出: { success: boolean, message: string, submittedAt: string }
```

- 内部为 **mock**：无论收到什么，一律返回 `success: true` 与一句确认 `message`，`submittedAt` 为当前时间戳字符串。
- 这一层是「真实业务处理」的占位边界——未来接数据库 / 外部 API 只改此函数体，端点契约与前端不变。
- 与 `chatFlow` 一样通过 Genkit 在 SSR server 暴露为 HTTP 端点。

## 前端渲染 + 提交（方案 C 闭环）

### 数据层（`src/app/agent.service.ts`）
- `AgentResponse` 接口新增 `form?: FormSpec`。
- 新增提交方法：调用 `/submitForm`，入参 `{ formId, sessionId, data }`，复用当前 `sessionId()`。

### 视图层
- 新增**动态表单组件**：输入一个 `FormSpec`，按 `field.type` 渲染对应控件（text→input、textarea→textarea、number→number input、select→下拉、checkbox→勾选框），并实现 `required` 必填校验。
- `agent-chat.component.html`：当 `agentResource.value().form` 存在时，在对话区渲染该动态表单组件。

### 提交流程（双路）
用户填写并点击提交后：
1. 前端调 `/submitForm` → 拿到 `{ success: true, message }`。
2. **路①（即时回执）**：在对话区立即渲染一条成功回执气泡（展示 `message`，如「提交成功 ✅」）。
3. **路②（回喂续聊）**：把「用户已提交表单 `formId`，数据为 …」序列化后，带**同一个 `sessionId`** 再调一次 `chatFlow`，Agent 接话续聊。

## 数据流

```
用户提问
  → chatFlow → { agentResponse: "请填写以下信息", form: {...} }
  → 前端渲染动态表单组件
  → 用户填写并提交
  → /submitForm（mock 永远成功）→ { success: true, message, submittedAt }
  → 前端：
       ① 即时渲染成功回执气泡
       ② 带同一 sessionId 回喂 chatFlow
  → chatFlow → { agentResponse: "已为您完成提交…" }   ← 对话延续
```

## 错误处理

- **模型输出不合法**：由 Genkit 结构化输出在 schema 层拦截并触发模型重试，避免脏 schema 流到前端。
- **前端必填校验未通过**：阻止提交，在对应字段提示，不发起 `/submitForm` 请求。
- **`/submitForm` 请求失败（网络等）**：前端展示错误提示气泡，不进行路②回喂；用户可重试提交（mock 本身不会返回失败）。

## 测试要点

- `chatFlow` 在「需要表单」的输入下产出含合法 `form` 的输出；在普通问答下 `form` 缺省、原文字 / 选项链路不受影响（向后兼容回归）。
- `/submitForm` 对任意输入返回 `success: true`。
- 前端：各字段类型正确渲染；必填校验生效；提交后即时回执气泡出现，且 `chatFlow` 被以同一 `sessionId` 再次调用。

## 后续迭代（本次不做）

- 富字段类型：`email` / `password` / `date` / `radio` / 文件上传。
- `/submitForm` 接真实业务系统（数据库 / 外部 API）。
- 表单数据的服务端持久化与多表单状态管理。
