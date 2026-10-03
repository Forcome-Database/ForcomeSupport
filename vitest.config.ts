import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// 两类测试（规格「测试接缝」）：unit 是纯函数与不需要数据库的测试；
// integration 需要真实 PostgreSQL 18（本机 docker-compose.dev.yml，CI 用服务容器）。
// 与 apps/web 的 vite.config.ts 相同的路径别名，前端源码里的 @/ 引用在单元测试中也能解析
const webAlias = { '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)) };

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias: webAlias },
        test: {
          name: 'unit',
          include: [
            'packages/*/src/**/*.test.ts',
            'apps/*/src/**/*.test.{ts,tsx}',
            'apps/*/test/**/*.test.ts',
            'deploy/**/*.test.mjs',
          ],
          exclude: ['**/node_modules/**', '**/*.int.test.ts'],
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'integration',
          include: ['apps/server/**/*.int.test.ts'],
          exclude: ['**/node_modules/**'],
          globalSetup: ['apps/server/test/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
