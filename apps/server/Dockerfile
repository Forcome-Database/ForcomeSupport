# 后端镜像（ADR 0005、0006）：一个镜像，api、worker、migrate 三个入口，用 command 选择：
#   docker run <image>                          → api（默认）
#   docker run <image> node dist/worker.mjs     → worker
#   docker run <image> node dist/migrate.mjs    → migrate（一次性，先于 api 与 worker）
#   docker run <image> node dist/seed.mjs       → 灌示例数据（只用于非生产环境，先跑 migrate）
#   docker run <image> node dist/reset-inbound.mjs → 重放来信：清空收信与工单（只用于非生产环境，先停 worker）
# 构建上下文是仓库根目录：docker build -f apps/server/Dockerfile -t forcome-server .
FROM node:24-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY packages/calendar/package.json packages/calendar/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/fixtures/package.json packages/fixtures/
RUN pnpm install --frozen-lockfile --filter "@forcome/server..."
COPY packages packages
COPY apps/server apps/server
RUN pnpm --filter @forcome/server build \
 && pnpm --filter @forcome/server deploy --prod --legacy /out

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/server/dist ./dist
COPY --from=build /repo/apps/server/drizzle ./drizzle
USER node
CMD ["node", "dist/api.mjs"]
