---
status: accepted
---

# 模型接入层用 Vercel AI SDK，Claude 经 NewAPI 以 Anthropic 原生格式调用

生产系统的模型层要同时适配 Claude、OpenAI GPT 与任意 OpenAI 兼容接口。接入层采用 Vercel AI SDK（`ai` 包）统一调用，按提供方分别用 `@ai-sdk/anthropic`（经 NewAPI 网关的 Anthropic 原生 `/v1/messages`）、`@ai-sdk/openai`（GPT 走 Responses API）与 `@ai-sdk/openai-compatible`（其他兼容接口）。选它而不是自写薄适配层，是为了用一套成熟的统一接口承载工具调用、结构化输出与流式，减少自维护代码（2026-09-24 用户决定）。

## Considered Options

- 两家官方 SDK（`@anthropic-ai/sdk`、`openai`）+ 自写薄适配层与能力配置表：调研推荐项，控制力最强但要自维护三个适配器。
- LangChain.js：抽象过厚，依赖的 Anthropic SDK 落后，不采用。
- 以 OpenAI 兼容格式经 NewAPI 调 Claude：网关转换会丢失结构化输出、工具 `strict` 与缓存断点，不采用。

## Consequences

- Opus 5.5、Fable 5.1 禁止强制工具调用，而 AI SDK 有一种结构化输出模式依赖强制工具调用：必须锁定原生结构化输出模式，第 ④ 步回复检查用 Claude 原生结构化输出。
- AI SDK 大版本迭代快，需锁定版本、升级前跑回归评测。
- Claude 提示缓存断点经 `@ai-sdk/anthropic` 的提供方参数设置；GPT 为自动前缀缓存；兼容接口按无缓存估算成本。
- 结构化输出不可用时按四档降级（原生严格输出 → 非强制工具调用 + strict → 提示约束 + 本地校验修复重试 1 次 → 转人工，PRD E-03）；60 秒总时限由应用层统一截止时间控制，关闭 SDK 自带重试。
- 依据见分支 `research/llm-compat` 的 `docs/research/多模型接入.md`。
