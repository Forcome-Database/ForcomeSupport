Title: 讨论：集成层设计与「MCP 形式」的含义
Type: grilling
Status: open
Blocked by: 01, 02, 03, 15
Map: ../map.md

# 讨论：集成层设计与「MCP 形式」的含义

## Question

统一动作接口（F-AP-02）和各平台适配器怎么设计？PRD 写的「MCP 形式」具体指什么？

已定：外部数据来源按记账方分工（ADR 0002）：补发、出库、易仓库存、运费与订单读取经积加；退款、取消、改地址走 SP-API（Feeds 异步）与 Shopify Admin API；轨迹走 17TRACK；来信走 Gmail。

要定：「MCP 形式」是指每个适配器做成独立 MCP 服务器、供 AI 代理以工具调用，还是内部统一接口、对 AI 暴露为工具；统一动作的接口形状（9 个动作）、店铺凭据隔离（R-ST-03）；接口失败时转人工操作清单（R-AP-04、R-AP-05）的衔接；积加与 SP-API 能力缺口的兜底方案；外部调用经代理的统一出口。
