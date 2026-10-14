# 钉钉群机器人的接收替身（只用于开发测试环境的告警演练，deploy/robot-sink/server.mjs）：只用 Node 自带的模块
FROM node:24-slim
WORKDIR /app
COPY deploy/robot-sink/server.mjs ./
USER node
CMD ["node", "server.mjs"]
