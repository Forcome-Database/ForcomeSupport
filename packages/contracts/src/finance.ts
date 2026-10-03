import { z } from 'zod';
import { grantsFor } from './capabilities';
import type { Role } from './roles';

/*
 * 财务字段过滤（PRD 10.1「查看成本、承担比例与结算金额」、10.3；ADR 0010 修订）：
 * 成本、承担比例、FSH / 工厂承担金额、结算金额只对客服主管、售后负责人返回（canViewFinance），
 * 其余角色在接口输出、报表聚合、导出、下钻与审计输出里一律过滤。
 *
 * 用法：在 contracts 的输出结构里用 financeField(…) 标出财务字段（字段因此是可选的），输出前按调用者的权限过滤——
 * 接口、导出与下钻用 stripFinanceFields 去掉字段；审计前后值用 maskFinanceFields 换成「已隐藏」标记（K18）。
 * 后端从请求的访问上下文取权限（org 的 access.financeVisible）。
 *
 * 不认识的一律不放行：过滤时结构里没声明的键也去掉；标记过的字段外面再包可选、可空、默认值、只读，
 * 或再加 describe / meta / openapi 说明，都认得出；懒加载（z.lazy）的结构展开后照常过滤。联合、交叉、记录、元组等结构里放了财务字段时直接报错
 * （认不出值属于哪个分支，宁可让开发时失败），财务字段只放在对象与列表里。
 */

const financeRegistry = z.registry<{ finance: true }>();

/** 标为财务字段：输出时对没有财务权限的角色去掉，所以在结构里是可选的 */
export function financeField<T extends z.ZodType>(schema: T): z.ZodOptional<T> {
  const field = schema.optional();
  financeRegistry.add(field, { finance: true });
  return field;
}

/**
 * 能否看到财务字段：要有 finance.view 的完整权限（客服主管、售后负责人）。
 * 生产厂对接人的「本厂部分」只在工厂工作台的专用输出里给（第二期，R-FT-02），在客服系统里不算有权限，
 * 兼有其他角色的生产厂对接人也看不到。
 */
export function canViewFinance(memberRoles: readonly Role[]): boolean {
  return grantsFor(memberRoles, 'finance.view').some((grant) => grant.kind === 'full');
}

/** 审计前后值里被隐藏的财务字段（界面写「已隐藏」，K18） */
export const FINANCE_HIDDEN = { hidden: 'finance' } as const;
export const financeHiddenSchema = z.object({ hidden: z.literal('finance') });

/** 只改变「可不可以缺、缺了用什么」的包装，内层就是字段本身 */
const WRAPPERS = new Set([
  'optional',
  'nullable',
  'default',
  'prefault',
  'readonly',
  'catch',
  'nonoptional',
]);

interface SchemaDef {
  readonly type: string;
  readonly innerType?: z.ZodType;
  readonly shape?: Record<string, z.ZodType>;
  readonly element?: z.ZodType;
  readonly options?: readonly z.ZodType[];
  readonly left?: z.ZodType;
  readonly right?: z.ZodType;
  readonly valueType?: z.ZodType;
  readonly items?: readonly z.ZodType[];
  readonly rest?: z.ZodType | null;
  readonly in?: z.ZodType;
  readonly out?: z.ZodType;
  readonly getter?: () => z.ZodType;
}

function defOf(schema: z.ZodType): SchemaDef {
  return schema._zod.def;
}

function unwrapOnce(schema: z.ZodType): z.ZodType | undefined {
  const def = defOf(schema);
  return WRAPPERS.has(def.type) ? def.innerType : undefined;
}

/** 是否财务字段（外面再包了可选、可空、默认值、只读，或加了说明，也认得出） */
export function isFinanceField(schema: z.ZodType): boolean {
  for (let current: z.ZodType | undefined = schema; current; current = unwrapOnce(current)) {
    // get 会顺着 describe / meta 复制出来的结构找到原来的标记，has 不会
    if (financeRegistry.get(current)?.finance === true) return true;
  }
  return false;
}

function innermost(schema: z.ZodType): z.ZodType {
  let current = schema;
  for (let next = unwrapOnce(current); next; next = unwrapOnce(current)) current = next;
  return current;
}

/** 结构里任何位置有没有财务字段（懒加载的结构展开一次，自引用的不重复展开） */
function containsFinanceField(schema: z.ZodType, seen = new Set<z.ZodType>()): boolean {
  if (seen.has(schema)) return false;
  seen.add(schema);
  if (isFinanceField(schema)) return true;
  const def = defOf(innermost(schema));
  const children: (z.ZodType | null | undefined)[] = [
    ...Object.values(def.shape ?? {}),
    def.element,
    ...(def.options ?? []),
    def.left,
    def.right,
    def.valueType,
    ...(def.items ?? []),
    def.rest,
    def.in,
    def.out,
    def.getter?.(),
  ];
  return children.some((child) => child != null && containsFinanceField(child, seen));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function redact(schema: z.ZodType, value: unknown, mode: 'strip' | 'mask'): unknown {
  if (value === null || value === undefined) return value;
  const inner = innermost(schema);
  const def = defOf(inner);
  if (def.type === 'object' && def.shape) {
    if (!isPlainObject(value)) return value;
    const result: Record<string, unknown> = {};
    for (const [key, fieldValue] of Object.entries(value)) {
      const field = def.shape[key];
      // 结构里没声明的键不放行
      if (!field) continue;
      if (isFinanceField(field)) {
        if (mode === 'mask') result[key] = FINANCE_HIDDEN;
        continue;
      }
      result[key] = redact(field, fieldValue, mode);
    }
    return result;
  }
  if (def.type === 'array' && def.element) {
    return Array.isArray(value) ? value.map((item) => redact(def.element!, item, mode)) : value;
  }
  if (def.type === 'pipe' && def.out) return redact(def.out, value, mode);
  if (def.type === 'lazy' && def.getter) return redact(def.getter(), value, mode);
  if (containsFinanceField(inner)) {
    throw new Error(`财务字段只能放在对象与列表里，「${def.type}」结构里的财务字段过滤不了`);
  }
  return value;
}

/**
 * 接口输出、导出、下钻：没有财务权限时按结构去掉财务字段（嵌套的对象与列表也去掉）与结构里没声明的键；
 * 有权限原样返回
 */
export function stripFinanceFields<S extends z.ZodType>(
  schema: S,
  value: z.output<S>,
  visible: boolean,
): z.output<S> {
  return visible ? value : (redact(schema, value, 'strip') as z.output<S>);
}

/**
 * 审计前后值：没有财务权限时把财务字段的值换成 FINANCE_HIDDEN（不去掉，界面写「已隐藏」），
 * 结构里没声明的键去掉；有权限原样返回
 */
export function maskFinanceFields(schema: z.ZodType, value: unknown, visible: boolean): unknown {
  return visible ? value : redact(schema, value, 'mask');
}
