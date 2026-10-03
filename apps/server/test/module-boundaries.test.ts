import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

/*
 * 模块边界（ADR 0005）由 lint 在 CI 强制。这里用仓库真实的 ESLint 配置，
 * 把一段代码当作某个模块的文件去检查，断言边界规则的判定。
 */
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({ cwd: repoRoot });
});

/** 以 modules/<module>/index.ts 的身份检查代码，返回边界规则的报错 */
async function boundaryErrors(module: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, {
    filePath: `${repoRoot}/apps/server/src/modules/${module}/index.ts`,
  });
  return (result?.messages ?? [])
    .filter((m) =>
      ['boundaries/dependencies', 'no-restricted-syntax', 'no-restricted-imports'].includes(
        m.ruleId ?? '',
      ),
    )
    .map((m) => m.message);
}

describe('店铺数据范围只由 org 构造（ADR 0010 修订）', () => {
  it('其他模块自己造成员的店铺范围报错', async () => {
    const errors = await boundaryErrors(
      'ticket',
      `import { memberStoreScope } from '../core';
export const s = memberStoreScope({ allStores: true, storeIds: [] });
`,
    );
    expect(errors).toEqual([
      expect.stringContaining(
        "店铺范围（ADR 0010）：成员的店铺范围只由 org 构造，接口里用 c.get('access').stores",
      ),
    ]);
  });

  it('org 构造成员的范围、其他模块用类型与查询条件是允许的', async () => {
    expect(
      await boundaryErrors(
        'org',
        `import { memberStoreScope } from '../core';
export const s = memberStoreScope;
`,
      ),
    ).toEqual([]);
    expect(
      await boundaryErrors(
        'ticket',
        `import { storeScopeCondition, type StoreScope } from '../core';
export const f = (s: StoreScope) => storeScopeCondition;
`,
      ),
    ).toEqual([]);
  });
});

describe('模块边界 lint', () => {
  it('跨模块读别的模块的表（import 它的 schema.ts）报错', async () => {
    const errors = await boundaryErrors(
      'ticket',
      `import { channelSchema } from '../channel/schema';\nexport const s = channelSchema;\n`,
    );
    expect(errors).toEqual([
      '模块边界（ADR 0005）：ticket 只能经 channel/index.ts 调用它，不能直接引用其内部文件或读它的表',
    ]);
  });

  it('引用别的模块的内部文件报错，类型引用也不例外', async () => {
    const errors = await boundaryErrors(
      'aftersales',
      `import type { Tx } from '../core/runtime';\nexport type T = Tx;\n`,
    );
    expect(errors).toHaveLength(1);
  });

  it('经别的模块的 index.ts 调用是允许的', async () => {
    const errors = await boundaryErrors(
      'ticket',
      `import { transaction } from '../core';\nimport { runReportQuery } from '../report/index';\nexport const f = [transaction, runReportQuery];\n`,
    );
    expect(errors).toEqual([]);
  });

  it('report 可以读各模块的 schema.ts（配合只读数据库角色）', async () => {
    const errors = await boundaryErrors(
      'report',
      `import { ticketSchema } from '../ticket/schema';\nimport { coreSchema } from '../core/schema';\nexport const s = [ticketSchema, coreSchema];\n`,
    );
    expect(errors).toEqual([]);
  });

  it('report 也不能引用别的模块除 schema.ts 以外的内部文件', async () => {
    const errors = await boundaryErrors(
      'report',
      `import { recordAudit } from '../core/audit';\nexport const f = recordAudit;\n`,
    );
    expect(errors).toHaveLength(1);
  });

  it('core 不能依赖业务模块；integration 只能依赖 core', async () => {
    expect(
      await boundaryErrors(
        'core',
        `import { REPORT_READER_ROLE } from '../report';\nexport const r = REPORT_READER_ROLE;\n`,
      ),
    ).toEqual(['模块边界（ADR 0005）：core 是基础设施层，不能依赖其他模块']);
    expect(
      await boundaryErrors(
        'integration',
        `import { REPORT_READER_ROLE } from '../report';\nexport const r = REPORT_READER_ROLE;\n`,
      ),
    ).toEqual(['模块边界（ADR 0005）：integration 只能依赖 core，不能依赖业务模块']);
    expect(
      await boundaryErrors(
        'integration',
        `import { transaction } from '../core';\nexport const t = transaction;\n`,
      ),
    ).toEqual([]);
  });

  it('index.ts 不能用 export * 或直接转出本模块的表', async () => {
    expect(
      await boundaryErrors(
        'channel',
        `export * from './schema';
`,
      ),
    ).toEqual(['模块边界（ADR 0005）：index.ts 要逐个列出对外导出的服务与类型，不能 export *']);
    expect(
      await boundaryErrors(
        'channel',
        `export { channelSchema } from './schema';
`,
      ),
    ).toEqual(['模块边界（ADR 0005）：index.ts 不能转出本模块的表，别的模块要经本模块的服务读写']);
  });

  it('模块不能引用后端入口与组装代码', async () => {
    const errors = await boundaryErrors(
      'ticket',
      `import { createApp } from '../../app';\nexport const a = createApp;\n`,
    );
    expect(errors).toEqual(['模块边界（ADR 0005）：模块不能引用后端入口与组装代码']);
  });
});
