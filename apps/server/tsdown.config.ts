import { defineConfig } from 'tsdown';

// 一个镜像、三个入口（ADR 0005）：打包成 dist/api.mjs、dist/worker.mjs、dist/migrate.mjs；
// 另有只用于非生产环境的 dist/seed.mjs（灌示例数据，待办 02）与 dist/reset-inbound.mjs（重放来信，待办 10），
// 以及各环境都用的一次性命令 dist/import-aftersales.mjs（售后登记表导入，待办 27；映射表 JSON 一并打进包里）与
// dist/sp-api-token.mjs（录入卖家授权的刷新令牌，待办 12）、dist/order-backfill.mjs（开始订单回补，待办 13）。
// 工作区包（@forcome/*）是 TypeScript 源码，打进包里；其余依赖留在 node_modules。
export default defineConfig({
  entry: [
    'src/api.ts',
    'src/worker.ts',
    'src/migrate.ts',
    'src/seed.ts',
    'src/reset-inbound.ts',
    'src/import-aftersales.ts',
    'src/sp-api-token.ts',
    'src/order-backfill.ts',
  ],
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  dts: false,
  noExternal: [/^@forcome\//],
});
