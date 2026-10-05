import { describe, expect, it } from 'vitest';
import { importAftersalesRun } from './import-aftersales.mjs';

const resolve = (file) => `/repo/${file}`;

describe('售后登记表导入子命令的参数', () => {
  it('表格挂成容器里 /import/ 下的只读文件，沿用原名；试运行加 --dry-run', () => {
    expect(importAftersalesRun(['登记表.xlsx', '--dry-run'], resolve)).toEqual({
      volumes: ['/repo/登记表.xlsx:/import/登记表.xlsx:ro'],
      command: ['node', 'dist/import-aftersales.mjs', '/import/登记表.xlsx', '--dry-run'],
    });
  });

  it('另给映射表时挂到 /import/mapping/ 下（与表格重名也不冲突）', () => {
    expect(importAftersalesRun(['in/a.xlsx', '--mapping', 'm/a.xlsx'], resolve)).toEqual({
      volumes: ['/repo/in/a.xlsx:/import/a.xlsx:ro', '/repo/m/a.xlsx:/import/mapping/a.xlsx:ro'],
      command: [
        'node',
        'dist/import-aftersales.mjs',
        '/import/a.xlsx',
        '--mapping',
        '/import/mapping/a.xlsx',
      ],
    });
  });

  it('没给表格、给了两个表格或不认识的参数时报用法', () => {
    expect(importAftersalesRun([], resolve)).toHaveProperty('error');
    expect(importAftersalesRun(['a.xlsx', 'b.xlsx'], resolve)).toHaveProperty('error');
    expect(importAftersalesRun(['a.xlsx', '--force'], resolve)).toHaveProperty('error');
  });
});
