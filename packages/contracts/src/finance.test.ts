import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  canViewFinance,
  financeField,
  FINANCE_HIDDEN,
  isFinanceField,
  maskFinanceFields,
  stripFinanceFields,
} from './finance';

// 示范用的售后单输出结构（真正的结构随 19 号待办）：成本、承担比例、承担金额标为财务字段
const ratio = z.object({ fsh: z.int(), factory: z.int() });
const ledgerRow = z.object({
  no: z.string(),
  status: z.string(),
  productCost: financeField(z.string()),
  ratios: financeField(z.object({ product: ratio, freight: ratio })),
  fshShare: financeField(z.string().nullable()),
  tracking: z.string().nullable(),
});
const ledgerPage = z.object({
  rows: z.array(ledgerRow),
  total: z.object({ count: z.int(), fees: financeField(z.string()) }),
  owner: ledgerRow.nullable().optional(),
});

const row: z.output<typeof ledgerRow> = {
  no: 'S-20260909-0016',
  status: '已完成',
  productCost: '2.60',
  ratios: { product: { fsh: 100, factory: 0 }, freight: { fsh: 100, factory: 0 } },
  fshShare: '9.40',
  tracking: null,
};

describe('财务字段过滤（PRD 10.3：成本、承担比例、结算金额只对客服主管、售后负责人返回）', () => {
  it('标记过的字段是财务字段，包在可选、可空里也认得出', () => {
    expect(isFinanceField(ledgerRow.shape.productCost)).toBe(true);
    expect(isFinanceField(ledgerRow.shape.productCost.optional())).toBe(true);
    expect(isFinanceField(ledgerRow.partial().shape.ratios)).toBe(true);
    expect(isFinanceField(ledgerRow.shape.tracking)).toBe(false);
  });

  it('财务字段在输出结构里是可选的，去掉后仍符合结构', () => {
    const stripped = stripFinanceFields(ledgerRow, row, false);
    expect(ledgerRow.parse(stripped)).toEqual(stripped);
  });

  it('没有财务权限：去掉财务字段，其余原样', () => {
    expect(stripFinanceFields(ledgerRow, row, false)).toEqual({
      no: 'S-20260909-0016',
      status: '已完成',
      tracking: null,
    });
  });

  it('有财务权限：原样返回', () => {
    expect(stripFinanceFields(ledgerRow, row, true)).toEqual(row);
  });

  it('嵌套的对象与列表里的财务字段也去掉（列表行、合计行）', () => {
    const page = {
      rows: [row, { ...row, no: 'S-20260910-0017' }],
      total: { count: 2, fees: '20.30' },
    };
    expect(stripFinanceFields(ledgerPage, page, false)).toEqual({
      rows: [
        { no: 'S-20260909-0016', status: '已完成', tracking: null },
        { no: 'S-20260910-0017', status: '已完成', tracking: null },
      ],
      total: { count: 2 },
    });
    expect(stripFinanceFields(ledgerPage, { ...page, owner: null }, false)).toMatchObject({
      owner: null,
    });
  });

  it('审计前后值：财务字段换成「已隐藏」标记，不去掉，其他字段照常（K18）', () => {
    expect(maskFinanceFields(ledgerRow, row, false)).toEqual({
      no: 'S-20260909-0016',
      status: '已完成',
      productCost: FINANCE_HIDDEN,
      ratios: FINANCE_HIDDEN,
      fshShare: FINANCE_HIDDEN,
      tracking: null,
    });
    // 前值里没有的字段不凭空出现；有财务权限时原样
    expect(maskFinanceFields(ledgerRow, { no: 'S-1', tracking: '1Z' }, false)).toEqual({
      no: 'S-1',
      tracking: '1Z',
    });
    expect(maskFinanceFields(ledgerRow, row, true)).toEqual(row);
  });

  it('不认识的一律不放行：结构里没声明的键也去掉（两种模式都是），不是对象的值原样返回', () => {
    const withExtra = { ...row, extra: '9.99' } as typeof row;
    expect(stripFinanceFields(ledgerRow, withExtra, false)).not.toHaveProperty('extra');
    expect(maskFinanceFields(ledgerRow, withExtra, false)).not.toHaveProperty('extra');
    expect(stripFinanceFields(ledgerRow, withExtra, true)).toHaveProperty('extra');
    expect(maskFinanceFields(ledgerRow, null, false)).toBeNull();
    expect(maskFinanceFields(ledgerRow, 'S-1', false)).toBe('S-1');
  });

  it('标记过的字段再加说明、只读或可空包装，仍按财务字段过滤', () => {
    const decorated = z.object({
      no: z.string(),
      described: financeField(z.string()).describe('产品成本'),
      meta: financeField(z.string()).meta({ title: '运费' }),
      readonly: financeField(z.string()).readonly(),
      wrapped: financeField(z.string()).nullable().default(null),
    });
    expect(
      stripFinanceFields(
        decorated,
        { no: 'S-1', described: '1.00', meta: '2.00', readonly: '3.00', wrapped: '4.00' },
        false,
      ),
    ).toEqual({ no: 'S-1' });
  });

  it('懒加载的结构（如自引用的树）展开后照常过滤', () => {
    interface Node {
      no: string;
      cost?: string;
      children: Node[];
    }
    const node: z.ZodType<Node> = z.lazy(() =>
      z.object({ no: z.string(), cost: financeField(z.string()), children: z.array(node) }),
    );
    expect(
      stripFinanceFields(
        node,
        { no: 'S-1', cost: '1.00', children: [{ no: 'S-2', cost: '2.00', children: [] }] },
        false,
      ),
    ).toEqual({ no: 'S-1', children: [{ no: 'S-2', children: [] }] });
  });

  it('财务字段放进联合类型等认不出分支的结构里：过滤时直接报错，不放行', () => {
    const union = z.object({
      fee: z.union([
        z.object({ usd: financeField(z.string()) }),
        z.object({ none: z.literal(true) }),
      ]),
    });
    expect(() => stripFinanceFields(union, { fee: { usd: '1.00' } }, false)).toThrow(
      /财务字段只能放在对象与列表里/,
    );
    // 联合类型里没有财务字段时照常
    const plain = z.object({ status: z.union([z.literal('a'), z.literal('b')]) });
    expect(stripFinanceFields(plain, { status: 'a' }, false)).toEqual({ status: 'a' });
  });
});

describe('谁能看到财务字段', () => {
  it.each([
    [['supervisor'], true],
    [['aftersales_owner'], true],
    [['agent'], false],
    [['knowledge_owner'], false],
    [['admin'], false],
    // 生产厂对接人的「本厂部分」只在工厂工作台给，兼了坐席也看不到客服系统里的财务字段
    [['factory_contact'], false],
    [['agent', 'factory_contact'], false],
    [['agent', 'supervisor'], true],
  ] as const)('%j：%s', (memberRoles, expected) => {
    expect(canViewFinance(memberRoles)).toBe(expected);
  });
});
