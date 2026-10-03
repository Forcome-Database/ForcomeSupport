import type { MailSendPolicy } from '../core';

/*
 * 发信白名单（ADR 0013 修订：开发测试环境默认禁止向白名单外地址发信）。开关与白名单来自运行配置
 * （MAIL_SEND_ALLOWLIST_ONLY、MAIL_SEND_ALLOWLIST，core 的 loadConfig），非生产环境默认打开。
 * 发信的真实现（第二期的 Gmail 发信）从 RealClientContext 拿到守卫，发出前对全部收件人调用 assertAllowed：
 * 守卫放在离网络最近的一层，业务代码怎么调用都绕不过去。Fake 不真的发信，不需要检查。
 */

/** 单个完整地址；带显示名、多个地址或缺 @ 的写法都不算，一律不放行 */
const ADDRESS = /^[^\s@,<>]+@([^\s@,<>]+)$/;

/** 有收件人不在白名单里，整封不发 */
export class MailRecipientNotAllowedError extends Error {
  override name = 'MailRecipientNotAllowedError';
  /** 被拦下的收件人 */
  readonly recipients: readonly string[];

  constructor(recipients: readonly string[]) {
    super(`收件人不在发信白名单里，未发送：${recipients.join('、')}`);
    this.recipients = recipients;
  }
}

export class MailRecipientGuard {
  readonly allowlistOnly: boolean;
  readonly #addresses: ReadonlySet<string>;
  readonly #domains: ReadonlySet<string>;

  constructor(policy: MailSendPolicy) {
    this.allowlistOnly = policy.allowlistOnly;
    const entries = policy.allowlist.map((entry) => entry.toLowerCase());
    this.#addresses = new Set(entries.filter((entry) => !entry.startsWith('@')));
    this.#domains = new Set(
      entries.filter((entry) => entry.startsWith('@')).map((e) => e.slice(1)),
    );
  }

  /** 开关关闭时都放行；打开时只放行白名单里的完整地址与 @域名下的地址（域名精确匹配，不含子域名） */
  isAllowed(address: string): boolean {
    if (!this.allowlistOnly) return true;
    const normalized = address.trim().toLowerCase();
    const domain = ADDRESS.exec(normalized)?.[1];
    if (domain === undefined) return false;
    return this.#addresses.has(normalized) || this.#domains.has(domain);
  }

  /** 发信前调用：任一收件人不在白名单就抛 MailRecipientNotAllowedError，整封不发 */
  assertAllowed(recipients: readonly string[]): void {
    const blocked = recipients.filter((recipient) => !this.isAllowed(recipient));
    if (blocked.length > 0) {
      throw new MailRecipientNotAllowedError(blocked);
    }
  }
}
