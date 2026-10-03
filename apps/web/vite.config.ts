import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 主应用单页（ADR 0007）；开发时 /api 转给本机 api（PORT 默认 3000）
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': `http://127.0.0.1:${process.env.API_PORT ?? 3000}`,
    },
  },
});
