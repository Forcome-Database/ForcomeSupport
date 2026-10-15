import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { DemoFixture } from '@forcome/fixtures';
import { and, eq, inArray } from 'drizzle-orm';
import type { DbExecutor, Runtime } from '../core';
import { credential, mailboxCredential } from './schema';

/*
 * 动态凭据保管（ADR 0013「动态凭据用主密钥 AES-GCM 加密后存数据库，只有 integration 能解密」，待办 11）：
 * 各店铺的 Shopify 访问令牌等按「外部系统 × 店铺」存进 integration.credential，用主密钥 CREDENTIAL_MASTER_KEY 以 AES-256-GCM 加密
 * （node:crypto；每次写入随机 12 字节 IV，附加数据为「系统:店铺」，密文搬到别的行就解不开）。
 * 主密钥换了或密文被改，解密失败当作没有凭据（调用方重新换一个），不让旧数据挡住同步。
 */

/** 一份动态凭据（明文只在内存里） */
export interface StoredCredential {
  readonly secret: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

export interface CredentialVault {
  read(system: string, storeId: string): Promise<StoredCredential | null>;
  write(system: string, storeId: string, value: StoredCredential): Promise<void>;
  /**
   * 163 企业邮箱的客户端授权码明文（ADR 0015，待办 35）：只给 IMAP 的真实现登录用。没有保存、或主密钥换了 / 密文被改解不开，都为 null
   * （该邮箱为「未连接」，要管理员在 P18 重新填写）
   */
  readMailboxAuthCode(address: string): Promise<string | null>;
  /** 加密保存一个邮箱的客户端授权码（已有就替换）；在调用方的事务里写（P18 保存店铺） */
  writeMailboxAuthCode(db: DbExecutor, address: string, authCode: string, at: Date): Promise<void>;
}

/** 客户端授权码的附加数据：服务商与邮箱地址（密文搬到别的地址就解不开） */
const mailboxAad = (address: string) => `qiye163:${address}`;

/**
 * 已保存客户端授权码的邮箱与最近一次填写的时刻（不解密，只看有没有）：P18 写「已保存」，常驻连接据时刻判断授权码换了没有
 */
export async function savedMailboxAuthCodes(
  db: DbExecutor,
  addresses?: readonly string[],
): Promise<Map<string, Date>> {
  if (addresses && addresses.length === 0) return new Map();
  const rows = await db
    .select({ address: mailboxCredential.address, updatedAt: mailboxCredential.updatedAt })
    .from(mailboxCredential)
    .where(addresses ? inArray(mailboxCredential.address, [...addresses]) : undefined);
  return new Map(rows.map((row) => [row.address, row.updatedAt]));
}

/** 删掉这些邮箱的客户端授权码（P18 保存时删掉了邮箱、或把 163 企业邮箱改成了 Gmail；不需要主密钥） */
export async function deleteMailboxAuthCodes(
  db: DbExecutor,
  addresses: readonly string[],
): Promise<void> {
  if (addresses.length === 0) return;
  await db.delete(mailboxCredential).where(inArray(mailboxCredential.address, [...addresses]));
}

/** 示例数据里 163 企业邮箱的模拟授权码（Fake 不校验内容，P18 写「已保存」） */
export const FIXTURE_MAILBOX_AUTH_CODE = 'demo-qiye163-auth-code';

/**
 * 示例店铺的 163 企业邮箱存一个模拟授权码（非生产环境灌示例数据后，同 seedDemoData 开始订单回补）：已有的不动（管理员可能已重新填写）。
 * 没有主密钥（保管为 null）时什么也不做。返回这次存了哪些邮箱
 */
export async function seedFixtureMailboxAuthCodes(
  runtime: Runtime,
  vault: CredentialVault | null,
  fixture: DemoFixture,
): Promise<string[]> {
  if (!vault) return [];
  const addresses = fixture.stores
    .filter((store) => store.provider === 'qiye163')
    .map((store) => store.mailbox.toLowerCase());
  const saved = await savedMailboxAuthCodes(runtime.db, addresses);
  const missing = addresses.filter((address) => !saved.has(address));
  for (const address of missing) {
    await vault.writeMailboxAuthCode(
      runtime.db,
      address,
      FIXTURE_MAILBOX_AUTH_CODE,
      runtime.clock.now(),
    );
  }
  return missing;
}

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

export interface SealedSecret {
  readonly ciphertext: Buffer;
  readonly iv: Buffer;
  readonly authTag: Buffer;
}

/** 加密（附加数据把密文绑在这一行上） */
export function sealSecret(masterKey: Buffer, aad: string, secret: string): SealedSecret {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

/** 解密；主密钥不对、附加数据不对或密文被改都抛错 */
export function openSecret(masterKey: Buffer, aad: string, sealed: SealedSecret): string {
  const decipher = createDecipheriv(ALGORITHM, masterKey, sealed.iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(sealed.authTag);
  return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString('utf8');
}

const aadOf = (system: string, storeId: string) => `${system}:${storeId}`;

/** 存在 integration.credential 里的保管（api、worker 用）；没有主密钥时为 null，需要动态凭据的真实现以「未配置」失败 */
export function databaseCredentialVault(
  runtime: Runtime,
  masterKey: Buffer | null,
): CredentialVault | null {
  if (!masterKey) return null;
  return {
    async read(system, storeId) {
      const [row] = await runtime.db
        .select()
        .from(credential)
        .where(and(eq(credential.system, system), eq(credential.storeId, storeId)))
        .limit(1);
      if (!row) return null;
      try {
        return {
          secret: openSecret(masterKey, aadOf(system, storeId), row),
          issuedAt: row.issuedAt,
          expiresAt: row.expiresAt,
        };
      } catch {
        // 主密钥换过或密文被改：当作没有，调用方重新换一个
        return null;
      }
    },
    async write(system, storeId, value) {
      const sealed = sealSecret(masterKey, aadOf(system, storeId), value.secret);
      const row = {
        ...sealed,
        issuedAt: value.issuedAt,
        expiresAt: value.expiresAt,
        updatedAt: runtime.clock.now(),
      };
      await runtime.db
        .insert(credential)
        .values({ system, storeId, ...row })
        .onConflictDoUpdate({ target: [credential.system, credential.storeId], set: row });
    },
    async readMailboxAuthCode(address) {
      const [row] = await runtime.db
        .select()
        .from(mailboxCredential)
        .where(eq(mailboxCredential.address, address))
        .limit(1);
      if (!row) return null;
      try {
        return openSecret(masterKey, mailboxAad(address), row);
      } catch {
        // 主密钥换过或密文被改：当作没有授权码（未连接），要管理员重新填写
        return null;
      }
    },
    async writeMailboxAuthCode(db, address, authCode, at) {
      const row = { ...sealSecret(masterKey, mailboxAad(address), authCode), updatedAt: at };
      await db
        .insert(mailboxCredential)
        .values({ address, ...row })
        .onConflictDoUpdate({ target: mailboxCredential.address, set: row });
    },
  };
}
