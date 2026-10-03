import { defineConfig } from 'tsdown';

// 一个镜像、三个入口（ADR 0005）：打包成 dist/api.js、dist/worker.js、dist/migrate.js。
// 工作区包（@forcome/*）是 TypeScript 源码，打进包里；其余依赖留在 node_modules。
export default defineConfig({
  entry: ['src/api.ts', 'src/worker.ts', 'src/migrate.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  dts: false,
  noExternal: [/^@forcome\//],
});
