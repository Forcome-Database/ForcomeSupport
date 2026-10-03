# 前端的两个镜像（ADR 0007、0013），共用同一层依赖安装。构建上下文是仓库根目录。
#   --target web   → forcome-web：caddy 托管前端静态文件、把 /api 转给 api，并提供内网 HTTPS（默认目标）
#   --target smoke → forcome-smoke：部署后对本环境跑 apps/web/e2e 的 Playwright 冒烟
# 冒烟的底是与 pnpm-lock.yaml 里 @playwright/test 同版本的官方镜像（浏览器随之一致），版本由部署脚本传入。
ARG PLAYWRIGHT_VERSION

FROM node:24-slim AS deps
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/calendar/package.json packages/calendar/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/fixtures/package.json packages/fixtures/
RUN pnpm install --frozen-lockfile --filter "@forcome/web..."
COPY packages packages
COPY apps/web apps/web

FROM deps AS build
RUN pnpm --filter @forcome/web build

FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble AS smoke
# certutil：只在冒烟容器里把 caddy 根证书加进 Chromium 的证书库，不碰宿主机的系统证书库
RUN apt-get update \
 && apt-get install -y --no-install-recommends libnss3-tools \
 && rm -rf /var/lib/apt/lists/*
# 依赖装好的工作区整个拿过来（纯 JS 与 linux-x64 glibc 的预编译包，两种底都能用）
COPY --from=deps /repo /repo
COPY deploy/smoke/run-smoke.sh /usr/local/bin/run-smoke.sh
WORKDIR /repo/apps/web
ENTRYPOINT ["sh", "/usr/local/bin/run-smoke.sh"]

# 换成 DNS-01 证书时，这里改为用 caddy:<版本>-builder 经 xcaddy 编进 DNS 服务商插件（docs/部署说明.md）
FROM caddy:2.11 AS web
COPY deploy/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
