Title: 讨论：前端框架与工程
Type: grilling
Status: resolved
Blocked by: 05, 06
Map: ../map.md

# 讨论：前端框架与工程

## Question

在已定的 shadcn/ui + Tailwind CSS v4 之上，前端用什么框架与工程方式？

要定：Vite + React 单页应用还是 Next.js（私有化与内网部署下的取舍）；路由、服务端状态（TanStack Query）、表格（TanStack Table）、表单（react-hook-form + zod）、图表；原型设计令牌（`design/spec/ui.py`）迁移为 `globals.css` 的方式；舒适 / 紧凑两档密度的实现；工厂工作台手机端（钉钉内打开）是否同一应用。

## Answer

2026-09-24 用户同意全部推荐，详见 ADR [0007 前端用 Vite 单页应用与工厂工作台独立入口](../../../docs/adr/0007-前端用Vite单页应用与工厂工作台独立入口.md)。

- **框架**：Vite + React 19 单页应用，由 caddy 托管；TanStack Router（查询参数经 zod 校验，筛选条件放在 URL 里）。
- **库**：TanStack Query（SSE 通知触发缓存失效）、TanStack Table、react-hook-form + contracts 的 zod 模式、shadcn Charts；必要时用 Zustand。
- **令牌**：一次性脚本从 `ui.py` 生成 `globals.css`，此后以它为准。
- **密度**：`data-density` + CSS 变量，偏好存在服务端。
- **工厂工作台**：同一项目的独立入口 `factory.html`；公网只放行它、`/api/factory/*` 和钉钉免登。主应用只支持桌面 ≥ 1280px，工厂工作台以手机为主。
- **语言**：界面只做中文，不用 i18n 框架。
- **测试**：Vitest + Testing Library；Playwright 覆盖第 13 节验收标准；视觉人工对照原型。

## Comments

2026-09-24（交叉审查复核后修订，见 `reviews/复核结论.md`、PRD D-22）：
- 分辨率改为以 1440 × 900 为设计基准、最低可用宽度 1280（原 Answer 为「只支持 ≥ 1280px」）。
- 新增：只在非生产环境启用的开发登录；原型示例数据转 JSON 夹具，供 Playwright 使用。
