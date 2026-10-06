import { describe, expect, it } from 'vitest';
import { workNotificationText, type WorkNotificationItem } from './work-notifications';

/*
 * 钉钉工作通知的内容（ADR 0010「钉钉通知」：带对象编号与时间，同一人 5 分钟内合并）。
 * 时间按北京时间写「月-日 时:分」。
 */

const gmailDown: WorkNotificationItem = {
  title: 'Gmail 连接异常',
  body: 'support@forcome.mx 连续 3 次失败，来信暂存',
  objectLabel: 'P18 · Gmail',
  createdAt: new Date('2026-09-11T10:05:00+08:00'),
};
const unassigned: WorkNotificationItem = {
  title: '未归属店铺来信',
  body: 'Tom Harris · Where is my order?',
  objectLabel: 'P04 · 未归属店铺',
  createdAt: new Date('2026-09-11T10:07:00+08:00'),
};

describe('工作通知的内容', () => {
  it('一条：标题、说明、对象与时间各一行', () => {
    expect(workNotificationText([gmailDown])).toBe(
      [
        '【Forcome Support】Gmail 连接异常',
        'support@forcome.mx 连续 3 次失败，来信暂存',
        'P18 · Gmail · 09-11 10:05',
      ].join('\n'),
    );
  });

  it('同一人 5 分钟内的几条合成一条：条数，之后每条一行带对象与时间', () => {
    expect(workNotificationText([gmailDown, unassigned])).toBe(
      [
        '【Forcome Support】2 条新通知',
        '· Gmail 连接异常：support@forcome.mx 连续 3 次失败，来信暂存（P18 · Gmail · 09-11 10:05）',
        '· 未归属店铺来信：Tom Harris · Where is my order?（P04 · 未归属店铺 · 09-11 10:07）',
      ].join('\n'),
    );
  });

  it('没有说明的不写说明', () => {
    expect(workNotificationText([{ ...gmailDown, body: '' }])).toBe(
      '【Forcome Support】Gmail 连接异常\nP18 · Gmail · 09-11 10:05',
    );
  });

  it('超过钉钉文本消息的 2048 字节时截掉后面的，末行写还有几条', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      ...unassigned,
      body: `第 ${i + 1} 封：${'很长的主题'.repeat(6)}`,
    }));
    const text = workNotificationText(many);
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(2048);
    const lines = text.split('\n');
    expect(lines[0]).toBe('【Forcome Support】40 条新通知');
    const shown = lines.filter((line) => line.startsWith('· 未归属店铺来信')).length;
    expect(shown).toBeGreaterThan(0);
    expect(lines.at(-1)).toBe(`· 另有 ${40 - shown} 条，请在系统里查看`);
  });
});
