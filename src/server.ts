import { APP_BASE_HREF } from '@angular/common';
import { CommonEngine, isMainModule } from '@angular/ssr/node';
import express from 'express';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expressHandler } from '@genkit-ai/express';
import bootstrap from './main.server';

// chatFlow handler —— 用惰性动态 import(首次请求时)加载,
// 以避免 server bundle 的顶层 await 限制。
let chatHandler: ((req: any, res: any, next: any) => void) | undefined;
let submitHandler: ((req: any, res: any, next: any) => void) | undefined;

async function getChatHandler() {
  if (!chatHandler) {
    const mod = await import('./flows');
    chatHandler = expressHandler(mod.chatFlow as any);
  }
  return chatHandler;
}

async function getSubmitHandler() {
  if (!submitHandler) {
    const mod = await import('./flows');
    submitHandler = expressHandler(mod.submitFlow as any);
  }
  return submitHandler;
}

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');
const indexHtml = join(serverDistFolder, 'index.server.html');

const app = express();
const commonEngine = new CommonEngine({
  allowedHosts: ['localhost', '127.0.0.1', '[::1]'],
});

// 解析 JSON 请求体(Genkit flow 端点需要)
app.use(express.json());

/**
 * Genkit flow 端点 —— 前端通过 runFlow({ url: '/chatFlow' }) 调用。
 * 必须定义在静态资源/SSR 处理之前,否则会被通配路由吞掉。
 * 用惰性加载的 handler,首次请求时才加载 flows.ts。
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
 * 表单提交端点 —— 前端通过 runFlow({ url: '/submitForm' }) 调用。
 */
app.post('/submitForm', async (req, res, next) => {
  try {
    const handler = await getSubmitHandler();
    handler(req, res, next);
  } catch (err) {
    next(err);
  }
});

/**
 * 提供 /browser 下的静态资源文件。
 */
app.get(
  '**',
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: 'index.html'
  }),
);

/**
 * 其余所有请求交给 Angular 做服务端渲染(SSR)。
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
 * 当本模块作为主入口运行时启动服务器。
 * 监听端口由环境变量 `PORT` 指定,未设置时默认 8540。
 */
if (isMainModule(import.meta.url)) {
  const port = process.env['PORT'] || 8540;
  app.listen(port, () => {
    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

export default app;
