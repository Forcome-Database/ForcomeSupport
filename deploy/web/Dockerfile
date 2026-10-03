# 前端镜像 forcome-web（ADR 0007、0013）：caddy 托管前端静态文件、把 /api 转给 api，并提供内网 HTTPS。
# 构建上下文是仓库根目录：docker build -f deploy/web/Dockerfile -t forcome-web .
FROM node:24-slim AS build
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
RUN pnpm --filter @forcome/web build

# 换成 DNS-01 证书时，这里改为用 caddy:<版本>-builder 经 xcaddy 编进 DNS 服务商插件（docs/部署说明.md）
FROM caddy:2.11
COPY deploy/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
