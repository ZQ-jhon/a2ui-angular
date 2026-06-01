import { APP_BASE_HREF } from '@angular/common';
import { CommonEngine, isMainModule } from '@angular/ssr/node';
import express from 'express';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expressHandler } from '@genkit-ai/express';
import bootstrap from './main.server';

// 根据 MOCK_LLM 环境变量选择 flow 实现:
//   - 设了 MOCK_LLM(如 `npm run mock`)→ 用本地模拟,无需任何 API Key。
//   - 未设 → 用真实的 OpenRouter/Claude 驱动的 chatFlow。
// 接口与返回结构两者完全一致,前端无感知。
// 用惰性动态 import(首次请求时)以避免 server bundle 的顶层 await 限制,
// 同时确保 Mock 模式下完全不加载真实 flows.ts(不初始化 OpenRouter 插件)。
const useMock = !!process.env['MOCK_LLM'];
let chatHandler: ((req: any, res: any, next: any) => void) | undefined;

async function getChatHandler() {
  if (!chatHandler) {
    const mod = useMock ? await import('./flows.mock') : await import('./flows');
    chatHandler = expressHandler(mod.chatFlow as any);
  }
  return chatHandler;
}

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');
const indexHtml = join(serverDistFolder, 'index.server.html');

const app = express();
const commonEngine = new CommonEngine();

// 解析 JSON 请求体(Genkit flow 端点需要)
app.use(express.json());

/**
 * Genkit flow 端点 —— 前端通过 runFlow({ url: '/chatFlow' }) 调用。
 * 必须定义在静态资源/SSR 处理之前,否则会被通配路由吞掉。
 * 用惰性加载的 handler:首次请求时才按 MOCK_LLM 选择真实/Mock flow。
 */
app.post('/chatFlow', async (req, res, next) => {
  try {
    const handler = await getChatHandler();
    handler(req, res, next);
  } catch (err) {
    next(err);
  }
});

/**
 * Serve static files from /browser
 */
app.get(
  '**',
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: 'index.html'
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.get('**', (req, res, next) => {
  const { protocol, originalUrl, baseUrl, headers } = req;

  commonEngine
    .render({
      bootstrap,
      documentFilePath: indexHtml,
      url: `${protocol}://${headers.host}${originalUrl}`,
      publicPath: browserDistFolder,
      providers: [{ provide: APP_BASE_HREF, useValue: baseUrl }],
    })
    .then((html) => res.send(html))
    .catch((err) => next(err));
});

/**
 * Start the server if this module is the main entry point.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url)) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, () => {
    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

export default app;
