// 模块边界规则（ADR 0005）：模块只经各自 index.ts 被调用，不跨模块读写表；
// 唯一例外是 report 可以读各模块的 schema.ts（配合只读数据库角色）。
import boundaries from 'eslint-plugin-boundaries';

/** 后端模块所在目录，相对仓库根目录 */
export const MODULES_DIR = 'apps/server/src/modules';

const MODULE = { type: 'module' };
const moduleNamed = (name) => ({ type: 'module', captured: { name } });

/** @type {import('eslint').Linter.Config[]} */
export const boundariesConfig = [
  {
    files: ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          noWarnOnMultipleProjects: true,
          project: ['apps/*/tsconfig.json', 'packages/*/tsconfig.json'],
        },
      },
      // 元素按目录划分；先列更具体的，嵌套时外层成为 parents
      'boundaries/elements': [
        { type: 'module', pattern: `${MODULES_DIR}/*`, capture: ['name'], partialMatch: false },
        { type: 'server', pattern: 'apps/server/src', partialMatch: false },
        { type: 'server-test', pattern: 'apps/server/test', partialMatch: false },
        { type: 'web', pattern: 'apps/web/src', partialMatch: false },
        { type: 'package', pattern: 'packages/*', capture: ['name'], partialMatch: false },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'allow',
          policies: [
            {
              from: { element: MODULE },
              disallow: {
                to: {
                  element: {
                    type: 'module',
                    captured: { name: '!{{ from.element.captured.name }}' },
                    fileInternalPath: '!index.ts',
                  },
                },
              },
              message:
                '模块边界（ADR 0005）：{{ from.element.captured.name }} 只能经 {{ to.element.captured.name }}/index.ts 调用它，不能直接引用其内部文件或读它的表',
            },
            {
              // report 用只读角色直读各模块的表（ADR 0005、0006）
              from: { element: moduleNamed('report') },
              allow: { to: { element: { type: 'module', fileInternalPath: 'schema.ts' } } },
            },
            {
              from: { element: moduleNamed('core') },
              disallow: { to: { element: { type: 'module', captured: { name: '!core' } } } },
              message: '模块边界（ADR 0005）：core 是基础设施层，不能依赖其他模块',
            },
            {
              from: { element: moduleNamed('integration') },
              disallow: {
                to: { element: { type: 'module', captured: { name: '!{core,integration}' } } },
              },
              message: '模块边界（ADR 0005）：integration 只能依赖 core，不能依赖业务模块',
            },
            {
              from: { element: MODULE },
              disallow: { to: { element: { type: 'server' } } },
              message: '模块边界（ADR 0005）：模块不能引用后端入口与组装代码',
            },
            {
              from: { element: { type: 'server' } },
              disallow: { to: { element: { type: 'module', fileInternalPath: '!index.ts' } } },
              message:
                '模块边界（ADR 0005）：入口只能经 {{ to.element.captured.name }}/index.ts 使用模块',
            },
            {
              from: { element: { type: 'package' } },
              disallow: {
                to: { element: { types: { anyOf: ['module', 'server', 'server-test', 'web'] } } },
              },
              message: '共享包不能依赖应用代码',
            },
            {
              from: { element: { type: 'web' } },
              disallow: {
                to: { element: { types: { anyOf: ['module', 'server', 'server-test'] } } },
              },
              message: '前端不能引用后端代码（共享的模式与类型放 packages/contracts）',
            },
          ],
        },
      ],
    },
  },
  {
    // 店铺数据范围（ADR 0010 修订）：成员的范围只由 org 按会话构造，其他模块从访问上下文取（c.get('access').stores），
    // 不能自己造一个「全部店铺」绕过范围；后台任务等系统操作用 SYSTEM_STORE_SCOPE（接口里经 access.findOwned），
    // 由评审检查调用方。
    files: [`${MODULES_DIR}/*/**/*.ts`],
    ignores: [`${MODULES_DIR}/org/**`, `${MODULES_DIR}/core/**`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/core', '**/core/index'],
              importNames: ['memberStoreScope'],
              message:
                "店铺范围（ADR 0010）：成员的店铺范围只由 org 构造，接口里用 c.get('access').stores",
            },
          ],
        },
      ],
    },
  },
  {
    // 堵住「经 index.ts 转手把表交出去」的口子：入口要逐个列出导出项，且不能直接转出 schema.ts。
    // 先 import 表再按名字导出的写法 lint 查不到，靠评审把关（ADR 0005 修订）。
    files: [`${MODULES_DIR}/*/index.ts`],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportAllDeclaration',
          message: '模块边界（ADR 0005）：index.ts 要逐个列出对外导出的服务与类型，不能 export *',
        },
        {
          selector: 'ExportNamedDeclaration[source.value=/(^|\\/)schema$/]',
          message:
            '模块边界（ADR 0005）：index.ts 不能转出本模块的表，别的模块要经本模块的服务读写',
        },
      ],
    },
  },
];
