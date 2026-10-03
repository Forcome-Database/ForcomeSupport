# 部署后冒烟镜像 forcome-smoke（ADR 0013 修订）：对开发测试环境跑 apps/web/e2e 的 Playwright 用例。
# 底是与 pnpm-lock.yaml 里 @playwright/test 同版本的官方镜像（浏览器随之一致），版本由部署脚本传入。
# 构建上下文是仓库根目录。
ARG PLAYWRIGHT_VERSION
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble
# certutil：只在冒烟容器里把 caddy 根证书加进 Chromium 的证书库，不碰宿主机的系统证书库
RUN apt-get update \
 && apt-get install -y --no-install-recommends libnss3-tools \
 && rm -rf /var/lib/apt/lists/*
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
COPY deploy/smoke/run-smoke.sh /usr/local/bin/run-smoke.sh
WORKDIR /repo/apps/web
ENTRYPOINT ["sh", "/usr/local/bin/run-smoke.sh"]
