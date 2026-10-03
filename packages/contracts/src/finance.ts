import { z } from 'zod';

/*
 * 财务字段过滤（PRD 10.1「查看成本、承担比例与结算金额」、10.3；ADR 0010 修订）：
 * 成本、承担比例、FSH / 工厂承担金额、结算金额只对有 finance.view 能力的角色（客服主管、售后负责人）返回，
 * 其余角色在接口输出、报表聚合、导出、下钻与审计输出里一律过滤。
 *
 * 用法：在 contracts 的输出结构里用 financeField(…) 标出财务字段（字段因此是可选的），输出前按调用者的权限过滤——
 * 接口、导出与下钻用 stripFinanceFields 去掉字段；审计前后值用 maskFinanceFields 换成「已隐藏」标记（K18）。
 * 能力判断见 capabilities.ts 的 can(roles, 'finance.view')，后端从请求的访问上下文取（org 的 financeVisible）。
 * 支持对象、列表与可选 / 可空 / 默认值包装；联合类型里的财务字段认不出来，财务字段不要放进联合类型。
 */

const financeRegistry = z.registry<{ finance: true }>();

/** 标为财务字段：输出时对没有财务权限的角色去掉，所以在结构里是可选的 */
export function financeField<T extends z.ZodType>(schema: T): z.ZodOptional<T> {
  const field = schema.optional();
  financeRegistry.add(field, { finance: true });
  return field;
}

/** 审计前后值里被隐藏的财务字段（界面写「已隐藏」，K18） */
export const FINANCE_HIDDEN = { hidden: 'finance' } as const;
export const financeHiddenSchema = z.object({ hidden: z.literal('finance') });

function unwrapOnce(schema: z.ZodType): z.ZodType | undefined {
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault
  ) {
    return schema.unwrap() as z.ZodType;
  }
  return undefined;
}

/** 是否财务字段（外面再包了可选、可空、默认值也认得出） */
export function isFinanceField(schema: z.ZodType): boolean {
  for (let current: z.ZodType | undefined = schema; current; current = unwrapOnce(current)) {
    if (financeRegistry.has(current)) return true;
  }
  return false;
}

function innermost(schema: z.ZodType): z.ZodType {
  let current = schema;
  for (let next = unwrapOnce(current); next; next = unwrapOnce(current)) current = next;
  return current;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function redact(schema: z.ZodType, value: unknown, mode: 'strip' | 'mask'): unknown {
  const inner = innermost(schema);
  if (inner instanceof z.ZodObject && isPlainObject(value)) {
    const shape = inner.shape as Record<string, z.ZodType>;
    const result: Record<string, unknown> = {};
    for (const [key, fieldValue] of Object.entries(value)) {
      const field = shape[key];
      if (field && isFinanceField(field)) {
        if (mode === 'mask') result[key] = FINANCE_HIDDEN;
        continue;
      }
      result[key] = field ? redact(field, fieldValue, mode) : fieldValue;
    }
    return result;
  }
  if (inner instanceof z.ZodArray && Array.isArray(value)) {
    return value.map((item: unknown) => redact(inner.element as z.ZodType, item, mode));
  }
  return value;
}

/** 接口输出、导出、下钻：没有财务权限时按结构去掉财务字段（嵌套的对象与列表也去掉）；有权限原样返回 */
export function stripFinanceFields<S extends z.ZodType>(
  schema: S,
  value: z.output<S>,
  visible: boolean,
): z.output<S> {
  return visible ? value : (redact(schema, value, 'strip') as z.output<S>);
}

/** 审计前后值：没有财务权限时把财务字段的值换成 FINANCE_HIDDEN（不去掉，界面写「已隐藏」）；有权限原样返回 */
export function maskFinanceFields(schema: z.ZodType, value: unknown, visible: boolean): unknown {
  return visible ? value : redact(schema, value, 'mask');
}
