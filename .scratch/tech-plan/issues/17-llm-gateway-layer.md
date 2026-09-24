Title: 讨论：模型接入层设计
Type: grilling
Status: open
Blocked by: 07, 16
Map: ../map.md

# 讨论：模型接入层设计

## Question

生产系统如何接入模型，才能同时适配 Claude、OpenAI GPT 与 OpenAI 兼容接口、随时切换或混用？

已定：接入层用 Vercel AI SDK，Claude 经 NewAPI 走 Anthropic 原生格式，GPT 走 Responses，其他兼容接口走 Chat Completions（ADR 0001）。

要定：在 AI SDK 之上本系统统一接口的形状（对话、工具调用、结构化输出、流式）；按用途配置模型（风险拦截与意图分类、3 版草稿、回复检查、译文与摘要，PRD 5.1 五步处理）与主备切换；各家能力差异的处理（缺结构化输出或提示缓存时的降级方式）；发给模型前的买家个人信息脱敏；60 秒总时限与重试（E-03）；每次调用的记录（模型、token、成本、耗时）供评测与计费；在设置页（P19）或配置文件中暴露哪些选项。
