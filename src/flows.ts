/*!
 * Genkit flow —— 用 OpenRouter 代理的 Claude 替换官方示例的 Google Gemini。
 *
 * 关键点:
 * 1. 用 @genkit-ai/compat-oai 的 openAICompatible 插件接入 OpenRouter(OpenAI 兼容端点)。
 * 2. Node.js 内置 fetch(undici)默认【不读】HTTP_PROXY/HTTPS_PROXY,会直连出网;
 *    若直连出口 IP 落在 OpenRouter 区域限制范围,调用 Claude 会返回
 *    403 "This model is not available in your region."。解决:用 undici 的
 *    ProxyAgent 显式让 fetch 走本机代理(如 Clash 7890)。未配置代理时回退默认 fetch。
 * 3. 模型从 OPENROUTER_MODEL 环境变量读取(默认 anthropic/claude-opus-4.8)。
 * 4. 保留官方示例的 chatFlow 结构:通用聊天助手 + getDateTime 工具 + 结构化 JSON 输出。
 */
import 'dotenv/config';
import { Chat, genkit, Session } from 'genkit/beta';
import { openAICompatible, compatOaiModelRef } from '@genkit-ai/compat-oai';
import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { z } from 'zod';

// ── 代理 fetch ──────────────────────────────────────────────────────────────
// Only OpenRouter requests should use the proxy. Genkit Developer UI posts
// traces to localhost, so setting a global dispatcher would break trace saving.
const proxyUrl =
  process.env['HTTPS_PROXY'] ||
  process.env['https_proxy'] ||
  process.env['HTTP_PROXY'] ||
  process.env['http_proxy'];
const proxyAgent = proxyUrl
  ? new ProxyAgent({
      uri: proxyUrl,
      connectTimeout: 60_000,
      headersTimeout: 120_000,
      bodyTimeout: 120_000,
    })
  : undefined;

if (proxyUrl) {
  console.log(`[genkit] OpenRouter proxy enabled: ${proxyUrl}`);
}

const proxyFetch: any = (input: any, init?: any) => {
  if (!proxyAgent) {
    return fetch(input, init);
  }

  return undiciFetch(input, {
    ...init,
    dispatcher: proxyAgent,
  } as any);
};

// ── 模型 ────────────────────────────────────────────────────────────────────
const modelName = process.env['OPENROUTER_MODEL'] || 'anthropic/claude-opus-4.8';
const model = compatOaiModelRef({ name: `openrouter/${modelName}` });

console.log(`[genkit] 使用模型: ${modelName}`);

// ── Genkit 实例(OpenRouter 插件 + 默认模型)────────────────────────────────
const ai = genkit({
  plugins: [
    openAICompatible({
      name: 'openrouter',
      apiKey: process.env['OPENROUTER_API_KEY'],
      baseURL: 'https://openrouter.ai/api/v1',
      fetch: proxyFetch,
    }),
  ],
  model,
});

// ── 动态表单 schema ──────────────────────────────────────────────────────────
// Agent 在需要用户填写信息时,可在输出里附带一个 form。前端按字段类型渲染。
const FormFieldSchema = z.object({
  name: z.string().describe('提交时的字段 key'),
  label: z.string().describe('显示给用户的字段名'),
  type: z
    .enum(['text', 'textarea', 'number', 'select', 'checkbox'])
    .describe('控件类型'),
  required: z.boolean().describe('是否必填'),
  options: z
    .optional(z.array(z.string()))
    .describe('仅当 type 为 select 时提供的下拉选项'),
  placeholder: z.optional(z.string()),
});

const FormSpecSchema = z.object({
  formId: z.string().describe('本次表单实例 id,提交时回指'),
  title: z.string().describe('表单标题'),
  fields: z.array(FormFieldSchema),
  submitLabel: z.optional(z.string()).describe('提交按钮文案,默认"提交"'),
});

const ChatOutputSchema = z.object({
  agentResponse: z.string(),
  options: z.optional(z.array(z.string())),
  form: z.optional(FormSpecSchema).describe('需要用户填写信息时附带的表单'),
});

let session: Session;

const getDateTime = ai.defineTool(
  {
    name: 'getDateTime',
    description: 'Gets the current date and time',
    outputSchema: z.string(),
  },
  async () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    const formattedDate = `${year}-${month.toString().padStart(2, '0')}-${day
      .toString()
      .padStart(2, '0')}`;
    const formattedTime = `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    return `The current date and time is ${formattedDate} ${formattedTime}`;
  }
);

/**
 * chatFlow —— 通用聊天助手 flow(沿用官方示例结构)。
 * 前端通过 runFlow({ url: '/chatFlow' }) 调用。
 */
export const chatFlow = ai.defineFlow(
  {
    name: 'chatFlow',
    inputSchema: z.object({
      userInput: z.string(),
      sessionId: z.string(),
      clearSession: z.boolean(),
    }),
    outputSchema: ChatOutputSchema,
  },
  async ({ userInput, sessionId, clearSession }) => {
    if (userInput.length === 0) {
      userInput = 'Hi';
    }

    let chat: Chat;
    if (clearSession || !session) {
      session = ai.createSession({ sessionId });
      await session.updateMessages(sessionId, []);
    }
    chat = session.chat({ sessionId, model, tools: [getDateTime] });
    const prompt = `
    You're a general purpose assistant that can respond to a variety of user queries.

    If the user asks for the date and time, call a tool to get the date and time.

    User input: ${userInput}

    Respond to the user. You can ask the user clarifying questions to get more
    information.

    When you need to COLLECT STRUCTURED INFORMATION from the user (e.g. signing up,
    booking, filling in details), return a "form" in your response instead of a
    long list of questions. Set "agentResponse" to a short instruction (e.g.
    "Please fill in the form below") and populate "form":
      - form.formId: a unique id for this form instance
      - form.title: a short title
      - form.fields[]: each with
          - name: the key used when submitting
          - label: the human-readable label
          - type: one of "text", "textarea", "number", "select", "checkbox"
          - required: true/false
          - options: REQUIRED and only used when type is "select" (the choices)
          - placeholder: optional hint text
      - form.submitLabel: optional button text (defaults to "提交")
    Only include "form" when a form genuinely helps; otherwise omit it.

    If you ask the user a simple question, you may provide "options" (a few short
    strings) for quick replies. Do not provide "options" and "form" together.`;

    const { output } = await chat.send({
      prompt,
      output: { schema: ChatOutputSchema },
    });

    return output ?? { agentResponse: '' };
  }
);

/**
 * submitFlow —— 表单提交端点(MVP mock)。
 * 前端通过 runFlow({ url: '/submitForm' }) 调用。
 * 当前是占位实现:无论收到什么都返回成功。未来接真实业务系统
 *(校验/落库/调外部 API)只需替换此函数体,端点契约保持不变。
 */
export const submitFlow = ai.defineFlow(
  {
    name: 'submitFlow',
    inputSchema: z.object({
      formId: z.string(),
      sessionId: z.string(),
      data: z.record(z.unknown()),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      message: z.string(),
      submittedAt: z.string(),
    }),
  },
  async ({ formId }) => {
    return {
      success: true,
      message: `表单「${formId}」已提交成功。`,
      submittedAt: new Date().toISOString(),
    };
  }
);
