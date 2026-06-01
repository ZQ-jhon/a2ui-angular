import 'dotenv/config';
import { genkit, z } from 'genkit';
import { openAICompatible, compatOaiModelRef } from '@genkit-ai/compat-oai';
import { ProxyAgent } from 'undici';

// ──────────────────────────────────────────────────────────────────────────
// 代理处理：Node.js 内置 fetch（undici）默认【不读】HTTP_PROXY/HTTPS_PROXY
// 环境变量，会直连出网。若直连出口 IP 落在 OpenRouter 的区域限制范围，
// 调用 Claude 会返回 403 "This model is not available in your region."。
// 解决：显式用 undici 的 ProxyAgent 让 fetch 走本机代理（如 Clash 7890）。
// 代理地址从环境变量读取；未配置代理时回退到默认 fetch。
// ──────────────────────────────────────────────────────────────────────────
const proxyUrl =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;

const proxyFetch: any = proxyUrl
    ? (input: any, init?: any) =>
        fetch(input, { ...init, dispatcher: new ProxyAgent(proxyUrl) } as any)
    : fetch;

// 使用 OpenRouter（OpenAI 兼容端点）代理 Claude
// API Key 从环境变量读取（见 .env / .env.example）
const ai = genkit({
    plugins: [
        openAICompatible({
            name: 'openrouter',
            apiKey: process.env.OPENROUTER_API_KEY,
            baseURL: 'https://openrouter.ai/api/v1',
            fetch: proxyFetch,
        }),
    ],
});

// 定义模型引用：插件名 / OpenRouter 上的模型 ID
// 模型可通过 .env 的 OPENROUTER_MODEL 配置（不改代码即可切换），
// 未配置时默认 claude-opus-4.8。模型列表见 https://openrouter.ai/models
const modelName =
    process.env.OPENROUTER_MODEL || 'anthropic/claude-opus-4.8';

const claude = compatOaiModelRef({
    name: `openrouter/${modelName}`,
});

console.log(`[genkit] 使用模型: ${modelName}`);

// 输入 schema
const RecipeInputSchema = z.object({
    ingredient: z.string().describe('Main ingredient or cuisine type'),
    dietaryRestrictions: z
        .string()
        .optional()
        .describe('Any dietary restrictions'),
});

// 输出 schema
const RecipeSchema = z.object({
    title: z.string(),
    description: z.string(),
    prepTime: z.string(),
    cookTime: z.string(),
    servings: z.number(),
    ingredients: z.array(z.string()),
    instructions: z.array(z.string()),
    tips: z.array(z.string()).optional(),
});

// 定义菜谱生成 flow
export const recipeGeneratorFlow = ai.defineFlow(
    {
        name: 'recipeGeneratorFlow',
        inputSchema: RecipeInputSchema,
        outputSchema: RecipeSchema,
    },
    async (input) => {
        const prompt = `Create a recipe with the following requirements:
      Main ingredient: ${input.ingredient}
      Dietary restrictions: ${input.dietaryRestrictions || 'none'}`;

        const { output } = await ai.generate({
            model: claude,
            prompt,
            output: { schema: RecipeSchema },
            config: {
                temperature: 0.8,
            },
        });

        if (!output) throw new Error('Failed to generate recipe');

        return output;
    },
);

// 直接运行
async function main() {
    const recipe = await recipeGeneratorFlow({
        ingredient: 'avocado',
        dietaryRestrictions: 'vegetarian',
    });

    console.log(recipe);
}

// 仅在非 genkit dev 模式下直接运行
// genkit start 会通过 Reflection API 调用 flow，不需要 main()
const isGenkitDev = process.env.GENKIT_ENV === 'dev';

if (!isGenkitDev) {
    main().catch(console.error);
} else {
    // genkit start 模式下，保持进程运行，等待 Reflection API 调用
    console.log('[genkit] Dev mode — awaiting flow invocations via Reflection API...');
}
