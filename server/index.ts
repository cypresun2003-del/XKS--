import 'dotenv/config';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import express from 'express';
import { createApp } from './app';
import { Store } from './store';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const store = new Store(resolve(process.env.ZHUJIAN_DATA_DIR || resolve(root, 'data'), 'zhujian.sqlite'));
const app = createApp(store);
const port = Number(process.env.PORT || 4317);
if (process.argv.includes('--dev')) {
  const { createServer } = await import('vite');
  const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
} else {
  if (!existsSync(resolve(root, 'dist/index.html'))) { console.error('请先运行 npm run build，或使用 npm run dev。'); process.exit(1); }
  app.use(express.static(resolve(root, 'dist'), { index: false }));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve(root, 'dist/index.html')));
}
const server = app.listen(port, '127.0.0.1', () => console.log('第二视角已启动：http://127.0.0.1:' + port + '（仅本机可访问）'));
server.on('error', (error: NodeJS.ErrnoException) => { console.error(error.code === 'EADDRINUSE' ? '端口被占用，请关闭已有第二视角服务，或在 .env 中设置 PORT。' : '本地服务未能启动：' + error.code); store.close(); process.exit(1); });
const shutdown = () => server.close(() => { store.close(); process.exit(0); });
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
