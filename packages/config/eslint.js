// 全仓库共用的 ESLint 配置：TypeScript 类型感知规则 + React Hooks + 模块边界（ADR 0005）
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { boundariesConfig } from './eslint-boundaries.js';

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'design/**',
      'docs/**',
      '.scratch/**',
      'apps/server/drizzle/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ['**/*.{ts,tsx}'],
  })),
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: globals.browser },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // TanStack Router 用 throw redirect() 在 beforeLoad 里跳转（ADR 0007），只放行它的 Redirect
      '@typescript-eslint/only-throw-error': [
        'error',
        {
          allow: [{ from: 'package', package: '@tanstack/router-core', name: 'Redirect' }],
        },
      ],
    },
  },
  {
    // 浮层提示（G5）统一经 src/lib/notify.tsx 弹出（ADR 0007 修订），页面不直接调 sonner
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ignores: ['apps/web/src/lib/notify.tsx', 'apps/web/src/components/ui/sonner.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'sonner',
              message: '浮层提示（G5）统一用 @/lib/notify 的 showError 等入口，样式与行为照原型',
            },
          ],
        },
      ],
    },
  },
  ...boundariesConfig,
  prettier,
];
