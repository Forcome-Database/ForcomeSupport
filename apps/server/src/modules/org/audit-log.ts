import { addDays, businessDate, businessDateTime, startOfBusinessDate } from '@forcome/calendar';
import {
  apiErrorSchema,
  AUDIT_PAGE_SIZE,
  auditActionsLabelled,
  auditLogFilterSchema,
  auditLogOptionsSchema,
  auditLogQuerySchema,
  auditLogSchema,
  auditNameIds,
  auditObjectTypeLabels,
  auditRange,
  auditScope,
  describeAuditRecord,
  EXPORT_ROWS_HEADER,
  SYSTEM_ACTOR,
  SYSTEM_ACTOR_NAME,
  XLSX_CONTENT_TYPE,
  type AuditLog,
  type AuditLogEntry,
  type AuditLogFilter,
  type AuditLogOptions,
  type AuditRange,
} from '@forcome/contracts';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import ExcelJS from 'exceljs';
import {
  queryAuditLog,
  recordAudit,
  transaction,
  type AppEnv,
  type AuditLogConditions,
  type AuditLogPage,
  type AuditRecord,
  type AuditVisibility,
  type DbExecutor,
  type Runtime,
} from '../core';
import { requireCapability, requireSession, type Access, type AccessVariables } from './access';
import { listMembers, memberNamesById } from './members';

/*
 * P27 审计日志（PRD P27、10.2、K18、K5；规格 core「审计写入与查询」）：所有角色从头像菜单进入。
 * 查看范围按访问上下文算（10.2）：客服主管、管理员看全部，其他角色只看自己的操作记录（操作人锁定为本人）；
 * 都只列授权店铺的对象记录与没有店铺属性的记录（D-27）。查询在 core（queryAuditLog），这里把记录按查看者的权限
 * 写成 P27 的行（contracts 的 describeAuditRecord：没有财务权限时成本、承担比例等前后值为「已隐藏」，K18），并提供导出。
 * 接口在 org：查看范围取决于角色、店铺范围与财务权限（都在访问上下文里）；店铺名由组装根注入 channel 的 storeNamesById
 * （org 不依赖 channel，ADR 0005）。只读查询不记审计，导出记一条（K5）。
 */

/** 按 ID 查店铺名（channel 的 storeNamesById，由 app.ts 注入） */
export type StoreNamesById = (
  db: DbExecutor,
  ids: readonly string[],
) => Promise<ReadonlyMap<string, string>>;

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const unauthenticated = json(apiErrorSchema, '未登录或会话已失效');
const forbidden = json(apiErrorSchema, '没有查看审计日志的权限（只有生产厂对接人角色）');

const listRoute = createRoute({
  method: 'get',
  path: '/api/audit',
  summary:
    'P27 审计日志（10.2：客服主管、管理员看全部，其他角色只看自己的；只列授权店铺与没有店铺属性的记录；无财务权限的财务字段前后值为「已隐藏」）',
  request: { query: auditLogQuerySchema },
  responses: {
    200: json(auditLogSchema, '这一页的记录（时间倒序）与总条数'),
    400: json(apiErrorSchema, '筛选条件格式不对'),
    401: unauthenticated,
    403: forbidden,
  },
});

const optionsRoute = createRoute({
  method: 'get',
  path: '/api/audit/options',
  summary: 'P27 操作人筛选的选项：看全部时为「系统」与全部成员（含已停用），只看自己时只有本人',
  responses: {
    200: json(auditLogOptionsSchema, '选项'),
    401: unauthenticated,
    403: forbidden,
  },
});

const exportRoute = createRoute({
  method: 'get',
  path: '/api/audit/export',
  summary:
    '导出 Excel（K5）：按当前筛选（不分页）与查看范围、字段权限同步生成后直接下载，不留存文件；导出本身记审计',
  request: { query: auditLogFilterSchema },
  responses: {
    200: {
      description: `Excel 文件（文件名在 Content-Disposition 的 filename*，行数在 ${EXPORT_ROWS_HEADER}）`,
      content: { [XLSX_CONTENT_TYPE]: { schema: z.string().openapi({ format: 'binary' }) } },
    },
    400: json(apiErrorSchema, '筛选条件格式不对'),
    401: unauthenticated,
    403: forbidden,
  },
});

/** 查看范围（10.2）：只看自己的锁定为本人；都按店铺范围过滤 */
function visibilityOf(access: Access): AuditVisibility & { readonly scope: 'all' | 'own' } {
  const scope = auditScope(access.member.roles) ?? 'own';
  return {
    scope,
    stores: access.stores,
    ownActorId: scope === 'own' ? access.member.id : null,
  };
}

/** 筛选条件 → 查询条件（时间按北京时间的日界）；只看自己的不按操作人筛选（已锁定为本人） */
function conditionsOf(
  filter: AuditLogFilter,
  range: AuditRange,
  scope: 'all' | 'own',
): AuditLogConditions {
  const actor =
    scope === 'own' || !filter.actor
      ? undefined
      : filter.actor === SYSTEM_ACTOR
        ? { kind: 'system' as const }
        : { kind: 'member' as const, id: filter.actor };
  const q = filter.q?.trim();
  return {
    from: startOfBusinessDate(range.from),
    until: startOfBusinessDate(addDays(range.to, 1)),
    actor,
    objectType: filter.type,
    actions: filter.action ? auditActionsLabelled(filter.action) : undefined,
    objectLabel: q ? q : undefined,
  };
}

/** 把记录写成 P27 的行：先查要用到的店铺名与成员姓名 */
async function describe(
  db: DbExecutor,
  storeNamesById: StoreNamesById,
  records: readonly AuditRecord[],
  financeVisible: boolean,
): Promise<AuditLogEntry[]> {
  const ids = auditNameIds(records);
  const [stores, members] = await Promise.all([
    storeNamesById(db, [...ids.storeIds]),
    memberNamesById(db, [...ids.memberIds]),
  ]);
  return records.map((record) =>
    describeAuditRecord(record, { financeVisible, names: { stores, members } }),
  );
}

/** 操作人筛选的选项：「系统」与全部成员（含已停用的，他们的记录仍在），按角色顺序再按姓名 */
async function actorOptions(db: DbExecutor, access: Access): Promise<AuditLogOptions> {
  if (visibilityOf(access).scope === 'own') {
    return { actors: [{ value: access.member.id, label: access.member.name }] };
  }
  const rows = await listMembers(db);
  return {
    actors: [
      { value: SYSTEM_ACTOR, label: SYSTEM_ACTOR_NAME },
      ...rows.map((row) => ({ value: row.id, label: row.name })),
    ],
  };
}

/** 文件名（K5 的写法「报表_近7天_0905-0911.xlsx」）：今天「审计日志_今天_0911」，近 7 天、自定义写起止 */
export function auditExportFileName(range: AuditRange): string {
  const day = (date: string) => date.slice(5).replace('-', '');
  const span = range.from === range.to ? day(range.from) : `${day(range.from)}-${day(range.to)}`;
  if (range.period === 'today') return `审计日志_今天_${span}.xlsx`;
  if (range.period === 'week') return `审计日志_近7天_${span}.xlsx`;
  return `审计日志_${span}.xlsx`;
}

/** 一个字段的一行「字段：值」（已隐藏写「已隐藏」） */
function fieldLines(entry: AuditLogEntry, side: 'before' | 'after'): string | null {
  if (entry.fields.length === 0) return null;
  return entry.fields.map((field) => `${field.label}：${field[side] ?? '已隐藏'}`).join('\n');
}

interface ExportColumn {
  readonly header: string;
  readonly width: number;
  readonly value: (entry: AuditLogEntry) => string | null;
}

/** 导出的列：同页面的列，另把两栏前后值各写成一列（每个字段一行） */
const EXPORT_COLUMNS: readonly ExportColumn[] = [
  { header: '时间', width: 20, value: (entry) => businessDateTime(new Date(entry.at)) },
  { header: '操作人', width: 12, value: (entry) => entry.actor.name },
  { header: '角色', width: 16, value: (entry) => entry.actor.roleText || null },
  { header: '对象类型', width: 10, value: (entry) => auditObjectTypeLabels[entry.objectType] },
  { header: '对象', width: 24, value: (entry) => entry.objectLabel },
  { header: '动作', width: 14, value: (entry) => entry.actionLabel },
  {
    header: '变更摘要',
    width: 48,
    value: (entry) => (entry.more > 0 ? `${entry.summary} 等 ${entry.more} 项` : entry.summary),
  },
  { header: '来源 IP', width: 14, value: (entry) => entry.ip },
  { header: '变更前', width: 40, value: (entry) => fieldLines(entry, 'before') },
  { header: '变更后', width: 40, value: (entry) => fieldLines(entry, 'after') },
];
const SHEET_NAME = '审计日志';
const DENIED_FONT = { color: { argb: 'FFC8313B' }, bold: true };

/** 生成工作簿：表头、各行（前后值换行写），越权访问被拒的动作红字；冻结表头 */
async function workbookOf(entries: readonly AuditLogEntry[]): Promise<Uint8Array<ArrayBuffer>> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Forcome Support';
  const sheet = workbook.addWorksheet(SHEET_NAME, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = EXPORT_COLUMNS.map((column) => ({
    header: column.header,
    width: column.width,
    style: { alignment: { vertical: 'top', wrapText: true } },
  }));
  sheet.getRow(1).font = { bold: true };
  const actionColumn = EXPORT_COLUMNS.findIndex((column) => column.header === '动作') + 1;
  for (const entry of entries) {
    const row = sheet.addRow(EXPORT_COLUMNS.map((column) => column.value(entry)));
    if (entry.denied) row.getCell(actionColumn).font = DENIED_FONT;
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

/** P27 的接口：列表、操作人选项、导出 */
export function createAuditLogRoutes(deps: {
  runtime: Runtime;
  appEnv: AppEnv;
  storeNamesById: StoreNamesById;
}) {
  const { runtime, appEnv, storeNamesById } = deps;
  const routes = new OpenAPIHono<{ Variables: AccessVariables }>();
  for (const path of ['/api/audit', '/api/audit/*']) {
    routes.use(path, requireSession(runtime, appEnv));
    routes.use(path, requireCapability('audit.view'));
  }

  /** 这次按的时间与查询条件（今天按服务端时钟的北京时间） */
  function prepare(access: Access, filter: AuditLogFilter) {
    const visibility = visibilityOf(access);
    const today = businessDate(runtime.clock.now());
    const range = auditRange(filter, today);
    return { visibility, today, range, conditions: conditionsOf(filter, range, visibility.scope) };
  }

  routes.openapi(listRoute, async (c) => {
    const access = c.get('access');
    const query = c.req.valid('query');
    const { visibility, today, range, conditions } = prepare(access, query);
    const pageOf = (page: number): AuditLogPage => ({
      offset: (page - 1) * AUDIT_PAGE_SIZE,
      limit: AUDIT_PAGE_SIZE,
    });
    let page = query.page ?? 1;
    let result = await queryAuditLog(runtime.db, visibility, conditions, pageOf(page));
    // 页码超出（例如筛选后条数变少）时给最后一页
    const lastPage = Math.max(1, Math.ceil(result.total / AUDIT_PAGE_SIZE));
    if (page > lastPage) {
      page = lastPage;
      result = await queryAuditLog(runtime.db, visibility, conditions, pageOf(page));
    }
    const body: AuditLog = {
      today,
      range,
      scope: visibility.scope,
      financeVisible: access.financeVisible,
      total: result.total,
      denied: result.denied,
      page,
      pageSize: AUDIT_PAGE_SIZE,
      entries: await describe(runtime.db, storeNamesById, result.records, access.financeVisible),
    };
    return c.json(body, 200);
  });

  routes.openapi(optionsRoute, async (c) =>
    c.json(await actorOptions(runtime.db, c.get('access')), 200),
  );

  routes.openapi(exportRoute, async (c) => {
    const access = c.get('access');
    const filter = c.req.valid('query');
    const { visibility, range, conditions } = prepare(access, filter);
    const { records } = await queryAuditLog(runtime.db, visibility, conditions, null);
    const entries = await describe(runtime.db, storeNamesById, records, access.financeVisible);
    const body = await workbookOf(entries);
    const fileName = auditExportFileName(range);
    const q = filter.q?.trim();
    await transaction(runtime, (tx) =>
      recordAudit(tx, access.actor, {
        action: 'audit.export',
        objectType: 'export',
        objectId: 'audit.log',
        objectLabel: SHEET_NAME,
        after: {
          fileName,
          filters: {
            period: range.period,
            from: range.from,
            to: range.to,
            ...(visibility.scope === 'all' && filter.actor ? { actor: filter.actor } : {}),
            ...(filter.type ? { type: filter.type } : {}),
            ...(filter.action ? { action: filter.action } : {}),
            ...(q ? { q } : {}),
          },
          rows: entries.length,
        },
      }),
    );
    return c.body(body, 200, {
      'Content-Type': XLSX_CONTENT_TYPE,
      'Content-Disposition': `attachment; filename="audit-log.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      [EXPORT_ROWS_HEADER]: String(entries.length),
      'Cache-Control': 'no-store',
    });
  });

  return routes;
}
