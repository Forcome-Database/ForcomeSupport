import { defineConfig, devices } from '@playwright/test';

/*
 * Playwright 端到端（规格「测试接缝」辅助接缝二，ADR 0007）：全部 Fake + 开发登录 + 示例数据夹具。
 * 本机运行时自己起两个服务（端口在本期本机可用的 4510–4520 之内，ADR 0013 修订）：
 * - e2e api 4518：每次启动重建 e2e 专用库 forcome_e2e、迁移、灌示例数据（apps/server/scripts/e2e-api.ts）；
 * - 前端预览 4519：构建后的静态文件，/api 转给 4518。
 * 需要先 pnpm db:up。部署到开发测试环境后的冒烟由 03 号待办改为对该环境运行（设 E2E_BASE_URL 跳过本机服务）。
 */
const API_PORT = 4518;
const WEB_PORT = 4519;
const external = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  // 共用一个 e2e 库，按文件顺序跑
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  // 开发测试环境的冒烟（E2E_BASE_URL）在远端主机（2 GB，与别的容器共用）的容器里跑浏览器，比本机慢一倍上下且时快时慢：
  // 整条台账流程在那里要 20–34 秒、登录后等顶栏要近 5 秒（待办 36 查明的冒烟偶发：没有哪一步卡住，是整条用时与等待超了默认）。
  // 只对冒烟把用例时限与断言等待放宽一倍；本机照默认（30 秒、5 秒），变慢的回归在本机就能发现。产品自己的计时（撤销窗口等）不受影响
  timeout: external ? 60_000 : 30_000,
  expect: { timeout: external ? 10_000 : 5_000 },
  reporter: process.env.CI ? 'github' : 'list',
  outputDir: 'test-results',
  use: {
    baseURL: external ?? `http://127.0.0.1:${WEB_PORT}`,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      // 主应用只支持桌面（≥ 1280px，ADR 0007）；原型按 1440 × 900 画
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: external
    ? undefined
    : [
        {
          command: 'pnpm --filter @forcome/server e2e:api',
          url: `http://127.0.0.1:${API_PORT}/api/health`,
          reuseExistingServer: false,
          timeout: 120_000,
        },
        {
          command: 'pnpm exec vite build && pnpm exec vite preview',
          env: { API_PORT: String(API_PORT) },
          url: `http://127.0.0.1:${WEB_PORT}`,
          reuseExistingServer: false,
          timeout: 120_000,
        },
      ],
});
