import { describe, expect, it } from 'vitest';
import {
  defineClient,
  IntegrationClients,
  MailRecipientGuard,
  MailRecipientNotAllowedError,
} from './index';

/*
 * 发信白名单（ADR 0013 修订：开发测试环境默认禁止向白名单外地址发信）。第一期不发信，这里把开关就位：
 * 发信的真实现（第二期的 Gmail 发信）从 RealClientContext 拿到守卫，发出前逐个收件人检查。
 */

describe('发信白名单守卫', () => {
  it('开关关闭时任何地址都可以发', () => {
    const guard = new MailRecipientGuard({ allowlistOnly: false, allowlist: [] });
    expect(guard.isAllowed('oliver.turner@gmail.com')).toBe(true);
    expect(() => guard.assertAllowed(['oliver.turner@gmail.com'])).not.toThrow();
  });

  it('开关打开、白名单为空时一封也不发', () => {
    const guard = new MailRecipientGuard({ allowlistOnly: true, allowlist: [] });
    expect(guard.isAllowed('qa@forcome.com')).toBe(false);
  });

  it('完整地址按地址放行，@域名放行该域名下的所有地址，不分大小写', () => {
    const guard = new MailRecipientGuard({
      allowlistOnly: true,
      allowlist: ['qa.mailbox@gmail.com', '@forcome.com'],
    });
    expect(guard.isAllowed('QA.Mailbox@Gmail.com')).toBe(true);
    expect(guard.isAllowed('wang.lei@forcome.com')).toBe(true);
    expect(guard.isAllowed('oliver.turner@gmail.com')).toBe(false);
  });

  it('@域名不放行子域名，也不放行只是后缀相同的域名', () => {
    const guard = new MailRecipientGuard({ allowlistOnly: true, allowlist: ['@forcome.com'] });
    expect(guard.isAllowed('a@mail.forcome.com')).toBe(false);
    expect(guard.isAllowed('a@notforcome.com')).toBe(false);
    expect(guard.isAllowed('a@forcome.com.evil.io')).toBe(false);
  });

  it('不是单个完整地址的写法一律不放行（带显示名、多个地址、缺 @）', () => {
    const guard = new MailRecipientGuard({ allowlistOnly: true, allowlist: ['@forcome.com'] });
    expect(guard.isAllowed('Wang Lei <wang.lei@forcome.com>')).toBe(false);
    expect(guard.isAllowed('a@forcome.com,b@gmail.com')).toBe(false);
    expect(guard.isAllowed('forcome.com')).toBe(false);
  });

  it('有收件人不在白名单时整封拒发，错误里列出被拦的地址', () => {
    const guard = new MailRecipientGuard({ allowlistOnly: true, allowlist: ['@forcome.com'] });
    let error: unknown;
    try {
      guard.assertAllowed(['qa@forcome.com', 'oliver.turner@gmail.com', 'b@outlook.com']);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(MailRecipientNotAllowedError);
    expect((error as MailRecipientNotAllowedError).recipients).toEqual([
      'oliver.turner@gmail.com',
      'b@outlook.com',
    ]);
    expect(() => guard.assertAllowed(['qa@forcome.com'])).not.toThrow();
  });
});

describe('真实现经 RealClientContext 拿到守卫', () => {
  interface ExampleMailClient {
    send(to: readonly string[]): Promise<void>;
  }
  const sent: string[][] = [];
  const exampleMail = defineClient({
    system: 'example_mail',
    scope: 'global',
    createReal: ({ mailRecipientGuard }): ExampleMailClient => ({
      send: (to) =>
        Promise.resolve().then(() => {
          // 发出前检查全部收件人，再交给网络
          mailRecipientGuard.assertAllowed(to);
          sent.push([...to]);
        }),
    }),
    createFake: () => ({
      client: (): ExampleMailClient => ({ send: () => Promise.resolve() }),
      reset: () => undefined,
    }),
  });

  it('开发测试环境接了真实发信也只能发给白名单里的地址', async () => {
    const clients = new IntegrationClients({
      appEnv: 'staging',
      definitions: [exampleMail],
      clientModes: { example_mail: 'real' },
      mailSend: { allowlistOnly: true, allowlist: ['@forcome.com'] },
    });
    const mail = clients.global(exampleMail);

    await expect(mail.send(['oliver.turner@gmail.com'])).rejects.toBeInstanceOf(
      MailRecipientNotAllowedError,
    );
    await mail.send(['qa@forcome.com']);
    expect(sent).toEqual([['qa@forcome.com']]);
  });

  it('不传发信策略时按环境取默认：非生产只向白名单发信（白名单为空），生产不限制', () => {
    expect(
      new IntegrationClients({ appEnv: 'staging', definitions: [] }).mailRecipientGuard.isAllowed(
        'qa@forcome.com',
      ),
    ).toBe(false);
    expect(
      new IntegrationClients({
        appEnv: 'production',
        definitions: [],
      }).mailRecipientGuard.isAllowed('oliver.turner@gmail.com'),
    ).toBe(true);
  });
});
