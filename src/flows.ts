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
import { ProxyAgent } from 'undici';
import { parse } from 'partial-json';
import { z } from 'zod';

// ── 代理 fetch ──────────────────────────────────────────────────────────────
const proxyUrl =
  process.env['HTTPS_PROXY'] ||
  process.env['https_proxy'] ||
  process.env['HTTP_PROXY'] ||
  process.env['http_proxy'];

const proxyFetch: any = proxyUrl
  ? (input: any, init?: any) =>
      fetch(input, { ...init, dispatcher: new ProxyAgent(proxyUrl) } as any)
  : fetch;

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
    outputSchema: z.object({
      agentResponse: z.string(),
      options: z.optional(z.array(z.string())),
    }),
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

    Respond to the user and, if you ask the user a question, provide some options
    for the user to answer your question. You can ask the user clarifying questions
    to get more information.

    Final responses should be structured as follows:

    {
      agentResponse: "INSERT YOUR RESPONSE",
      options: [ // options to answer agentResponse if it is a question
        "option_1",
        "option_2",
        "option_3",
        ...
      ]
    }

    Respond as JSON only. Wrap all field values in double quotes. Do not use single quotes.`;

    const { text } = await chat.send({ prompt });
    return parse(maybeStripMarkdown(text));
  }
);

const markdownRegex = /^\s*(```json)?((.|\n)*?)(```)?\s*$/i;
function maybeStripMarkdown(withMarkdown: string) {
  const mdMatch = markdownRegex.exec(withMarkdown);
  if (!mdMatch) {
    return withMarkdown;
  }
  return mdMatch[2];
}
