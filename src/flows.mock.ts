/*!
 * Mock 版 chatFlow —— 无需任何大模型 API Key 即可本地预览整体应用功能。
 *
 * 用途:
 *   别人 clone 本项目后,即使没有购买/配置 OPENROUTER_API_KEY,
 *   也能通过 `npm run mock` 启动,直接体验完整的聊天 UI 与交互。
 *
 * 设计原则:
 *   1. 接口签名、输入/输出 schema、返回结构({agentResponse, options})
 *      与真实 flows.ts 的 chatFlow 完全一致 —— 前端无需任何改动。
 *   2. 完全不初始化 Genkit / OpenRouter 插件,不发任何网络请求,纯本地规则模拟。
 *   3. 复刻真实示例的 getDateTime 行为:用户问时间 → 返回当前真实日期时间。
 *   4. 维护一个极简的内存会话历史(按 sessionId),支持 clearSession 重置,
 *      以模拟"多轮对话"的观感。
 */
import { genkit } from 'genkit/beta';
import { z } from 'zod';
import { matchTemplate } from './templates';
import { normalizeInput } from './cache';

console.log('[genkit] ⚠️  MOCK 模式已启用 —— 使用本地模拟回复,未连接任何大模型。');
console.log('[genkit]     如需体验真实 Claude,请配置 OPENROUTER_API_KEY 后用 `npm start`。');

// 仅用于 defineFlow 的最小 Genkit 实例(无任何 model 插件,不会发网络请求)。
const ai = genkit({});

// ── 与真实 getDateTime 工具一致的时间格式化 ──────────────────────────────────
function currentDateTime(): string {
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

// ── 极简内存会话历史(模拟多轮观感)─────────────────────────────────────────
const mockSessions = new Map<string, number>();

interface MockReply {
  agentResponse: string;
  options?: string[];
}

/**
 * 纯规则的"假"回复生成器。根据用户输入的关键词返回贴近真实助手的内容,
 * 并尽量带上 options,以充分展示前端的选项气泡 UI。
 */
function generateMockReply(userInput: string, turn: number): MockReply {
  const input = userInput.trim().toLowerCase();

  // 问时间 → 复刻 getDateTime 工具行为
  if (/(time|date|几点|日期|时间|now|today)/.test(input)) {
    return {
      agentResponse: `${currentDateTime()} （Mock 模式：此为本地真实时间，未调用模型）`,
      options: ['再问点别的', 'What can you do?', '介绍一下这个项目'],
    };
  }

  // 打招呼
  if (/^(hi|hello|hey|你好|嗨|在吗|哈喽)/.test(input)) {
    return {
      agentResponse:
        '你好！我是一个演示用的聊天助手（当前运行在 Mock 模式，无需任何 API Key）。你可以试着问我问题，或从下面的选项里选一个。',
      options: ['What time is it?', '介绍一下这个项目', '你能做什么？'],
    };
  }

  // 询问能力
  if (/(what can you do|能做什么|功能|help|帮助|capabilities)/.test(input)) {
    return {
      agentResponse:
        '这是一个 Angular 19 SSR + Genkit 的全栈聊天应用 Demo。真实模式下由 OpenRouter 代理的 Claude 驱动；当前 Mock 模式用本地规则模拟回复，方便你零成本预览完整 UI 与交互（消息流、加载条、选项气泡等）。',
      options: ['What time is it?', '怎么切换到真实模型？', '给我讲个笑话'],
    };
  }

  // 怎么切换真实模型
  if (/(切换|真实|real|api key|openrouter|配置|怎么用真)/.test(input)) {
    return {
      agentResponse:
        '复制 .env.example 为 .env，填入你的 OPENROUTER_API_KEY（可选 OPENROUTER_MODEL，默认 anthropic/claude-opus-4.8），然后用 `npm start` 启动即可走真实 Claude。当前 Mock 模式则用 `npm run mock` 启动。',
      options: ['好的，明白了', 'What time is it?', '介绍一下这个项目'],
    };
  }

  // 讲笑话
  if (/(joke|笑话|讲个|搞笑|幽默)/.test(input)) {
    return {
      agentResponse:
        '为什么程序员总分不清万圣节和圣诞节？因为 Oct 31 == Dec 25。🎃（Mock 模式提供，真实模型会更有梗）',
      options: ['再来一个', 'What time is it?', '你能做什么？'],
    };
  }

  // 兜底:回显 + 提示这是 mock,带通用选项
  return {
    agentResponse: `（Mock 回复，第 ${turn} 轮）我收到了你的消息：「${userInput}」。当前为本地模拟模式，没有连接真实大模型，所以无法给出智能回答。配置好 OPENROUTER_API_KEY 并用 \`npm start\` 启动后即可体验真实 Claude。`,
    options: ['What time is it?', '怎么切换到真实模型？', '你能做什么？'],
  };
}

/**
 * Mock chatFlow —— 与真实 chatFlow 同名、同 schema、同返回结构。
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

    // 模板热点(注册/登录等)—— 与真实模式一致,优先匹配,跳过"模型"。
    const tpl = matchTemplate(normalizeInput(userInput));
    if (tpl) {
      console.log(`[cache] (mock) 模板命中: ${tpl.templateId}`);
      return { agentResponse: tpl.agentResponse, options: tpl.options };
    }

    if (clearSession || !mockSessions.has(sessionId)) {
      mockSessions.set(sessionId, 0);
    }
    const turn = (mockSessions.get(sessionId) ?? 0) + 1;
    mockSessions.set(sessionId, turn);

    // 模拟一点点"思考"延迟,让前端的加载条有机会出现(120~420ms)。
    await new Promise((r) => setTimeout(r, 120 + Math.random() * 300));

    return generateMockReply(userInput, turn);
  }
);
