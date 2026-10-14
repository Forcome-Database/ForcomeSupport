// report：报表与导出（ADR 0005；第一期起）。唯一可以读别的模块表的模块：经各模块 schema.ts 直读，
// 并且一律在只读数据库角色下执行（ADR 0006，read-only.ts 的 runReportQuery），写入会被数据库拒绝。
// 报表绕过了仓储层的店铺范围编译期保护，每个查询都要显式施加店铺范围与财务字段过滤（规格 report 一节）。
// 第一期：P17 的工单部分（待办 24）；售后成本卡与导出随待办 25。
export { REPORT_READER_ROLE, runReportQuery } from './read-only';
export { createReportRoutes } from './routes';
