import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Runtime } from '../core';
import { credential } from './schema';

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
  };
}
