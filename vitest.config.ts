import { defineConfig } from 'vitest/config';

// 两类测试（规格「测试接缝」）：unit 是纯函数与不需要数据库的测试；
// integration 需要真实 PostgreSQL 18（本机 docker-compose.dev.yml，CI 用服务容器）。
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: [
            'packages/*/src/**/*.test.ts',
            'apps/*/src/**/*.test.{ts,tsx}',
            'apps/*/test/**/*.test.ts',
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
