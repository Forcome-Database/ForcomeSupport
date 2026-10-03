import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 主应用单页（ADR 0007）。端口在本期本机可用的 4510–4520 之内（ADR 0013 修订）：
// 开发服务器 4517，/api 转给本机 api（dev.env 的 4516）；e2e 用的预览服务器 4519，转给 e2e api（4518）。
const apiPort = process.env.API_PORT ?? '4516';
const proxy = { '/api': `http://127.0.0.1:${apiPort}` };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  server: { host: '127.0.0.1', port: 4517, strictPort: true, proxy },
  preview: { host: '127.0.0.1', port: 4519, strictPort: true, proxy },
});
