# 04: NewAPI 模型渠道实测

Type: task
Status: open
Blocked by: None
Map: [第二期探路地图](../map.md)

## Question

NewAPI 网关上实际能用哪些模型：Claude、GPT 的具体型号与原生接口（Claude `/v1/messages`、GPT Responses）是否透传；嵌入与重排是否可用（`research/llm-uses` U-07、U-08）；工具调用、结构化输出、图片输入是否可用；限流与计费方式。模型选择与编排形态（见「AI 介入方式与同类最佳实践」）依赖这些事实。

HITL：用户提供 NewAPI 的地址与测试用 key（放在不进 git 的环境文件）；拿到后由代理逐项实测并记录结果（不写 key）。
