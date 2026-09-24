Title: 调研：多模型接入能力差异（Claude、OpenAI GPT、OpenAI 兼容接口、NewAPI 网关）
Type: research
Status: resolved
Map: ../map.md

# 调研：多模型接入能力差异（Claude、OpenAI GPT、OpenAI 兼容接口、NewAPI 网关）

## Question

模型层要同时适配 Claude（经 NewAPI 网关）、OpenAI GPT 与任意 OpenAI 兼容接口。五步处理依赖的能力在各家之间有什么差异，NewAPI 网关能透传多少？

需要查清：
- NewAPI（开源 LLM 网关）支持的上游与对外接口格式：OpenAI Chat Completions、OpenAI Responses、Anthropic Messages 原生格式；格式转换时哪些字段会丢失。
- 工具调用（function calling / tool use）、结构化输出（JSON Schema 约束）、提示缓存（Anthropic cache_control、OpenAI 自动缓存）、流式输出、图片输入、token 用量回报——在 Claude 原生、OpenAI 原生、OpenAI 兼容格式转发 Claude 三种路径下各自是否可用、差异在哪。
- 官方 SDK 与通用抽象库（如 Vercel AI SDK、LangChain.js、LiteLLM 思路）在 TypeScript 下对多厂商的支持程度与局限。
- 超时、重试、限流、错误码在网关后的表现（对应 PRD E-03：60 秒未返回转人工）。
- 结论：推荐的接口格式（经 NewAPI 走哪种格式调用 Claude 最能保留能力）与抽象层边界建议。

## Answer

详见分支 `research/llm-compat`（提交 91e58db）的 `docs/research/多模型接入.md`；NewAPI 结论来自源码核对，部分未实测。

- **调用格式**：经 NewAPI 调 Claude 用 Anthropic 原生 `/v1/messages`，缓存断点、工具调用、严格工具参数、结构化输出、thinking、流式、beta 请求头都能透传，缓存读写用量原样回报。网关会解析再重组请求，不认识的新顶层字段会被丢，需要时对该渠道开「透传请求体」（代价是流式用量要自己记）。
- **不可取**：以 OpenAI 格式经 NewAPI 调 Claude——转换代码不处理 `response_format`、工具 `strict` 与缓存断点，三项全部丢失；Anthropic 官方 OpenAI 兼容层也声明不适合生产。
- **其他厂商**：GPT 用 Responses API，其他 OpenAI 兼容接口用 Chat Completions。
- **抽象方案**：`@anthropic-ai/sdk`（0.128）+ `openai`（7.23）两家官方 SDK，自写薄适配层，下挂三个适配器（Anthropic Messages、OpenAI Responses、兼容 Chat），模型能力写入配置表。备选 Vercel AI SDK（`ai` 7.0.113）：其一种结构化输出模式靠强制工具调用，而 Opus 5.5、Fable 5.1 禁止强制工具调用会报 400，须锁定另一模式，且大版本迭代快。LangChain.js 抽象过厚、依赖的 Anthropic SDK 落后，不推荐。
- **结构化输出四档降级**：原生严格输出 → 非强制工具调用 + `strict` → 提示词约束 + 本地校验修复重试 1 次 → 仍失败按 E-03 转人工。第 ④ 步回复检查必须用 Claude 原生结构化输出（`output_config.format`）。
- **缓存**：Claude 显式断点；GPT 自动前缀缓存；兼容接口按无缓存估算成本。
- **用量**：统一为输入、输出、缓存读、缓存写四个字段，拿不到记「未知」而不是 0。
- **60 秒时限（E-03）**：应用层统一截止时间（AbortController）管第 ③ 步所有调用，关闭 SDK 自带重试、按剩余时间自行决定重试；流式加首字超时；NewAPI `RELAY_TIMEOUT` 保持 0 或 ≥ 90 秒；重试范围去掉 402–404、413 等不可重试状态码；连续失败时应用层熔断，直接走关键词兜底。
- **待确认**：NewAPI 对缓存读写是否分别计费；OpenAI 格式下用「参数覆盖」补缓存断点能否命中；429 的 `retry-after` 是否保留、流式中途出错的处理；第三期具体 Claude 模型；NewAPI 的 AGPLv3 许可对私有化部署的影响（软件许可问题，需法务判断）。

**对其他待办的影响**：「讨论：模型接入层设计」以本调研的推荐方案为起点（格式、适配器、能力配置表、降级、用量字段、时限策略），该待办现在只等「讨论：后端与数据库选型」。
