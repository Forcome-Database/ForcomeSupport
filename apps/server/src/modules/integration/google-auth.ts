import { importPKCS8, SignJWT, type CryptoKey } from 'jose';
import { z } from 'zod';
import type { GoogleCredentials } from '../core';
import { ExternalCallFailedError } from './faults';
import type { HttpClient } from './http';

/*
 * Google 服务账号的访问令牌（OAuth 2.0 服务账号流程，待办 09）：用密钥文件里的私钥签一个 JWT（RS256，jose），到 token_uri
 * 换访问令牌。全域委派时 JWT 的 sub 写要代表的邮箱，Gmail 就以该邮箱的身份调用；Pub/Sub 用服务账号本身（不写 sub）。
 * 令牌按「代表谁 × 权限范围」缓存到过期前 5 分钟；换令牌也经出站 HTTP 客户端工厂（代理、调用记录）。
 * 不用 google-auth-library：它的请求走自己的 gaxios，不经我们的代理分流与调用记录（ADR 0009 修订）。
 */

const tokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number() });

/** 过期前多久换新 */
const REFRESH_MARGIN_MS = 5 * 60_000;
/** JWT 的有效期（Google 最长 1 小时） */
const ASSERTION_SECONDS = 3600;

export interface GoogleTokens {
  /** 访问令牌：subject 为全域委派要代表的邮箱，不给为服务账号本身 */
  get(scope: string, subject?: string): Promise<string>;
  /** 令牌被拒（401）后丢掉缓存，下次重新换 */
  forget(scope: string, subject?: string): void;
}

export function createGoogleTokens(
  http: HttpClient,
  credentials: GoogleCredentials,
  now: () => number = Date.now,
): GoogleTokens {
  const cache = new Map<string, { value: string; expiresAt: number }>();
  let key: Promise<CryptoKey> | null = null;
  const keyOf = (scope: string, subject?: string) => `${subject ?? ''} ${scope}`;

  return {
    async get(scope, subject) {
      const cached = cache.get(keyOf(scope, subject));
      if (cached && cached.expiresAt - REFRESH_MARGIN_MS > now()) return cached.value;
      key ??= importPKCS8(credentials.privateKey, 'RS256');
      let assertion: string;
      try {
        const issuedAt = Math.floor(now() / 1000);
        const jwt = new SignJWT({ scope })
          .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
          .setIssuer(credentials.clientEmail)
          .setAudience(credentials.tokenUri)
          .setIssuedAt(issuedAt)
          .setExpirationTime(issuedAt + ASSERTION_SECONDS);
        if (subject) jwt.setSubject(subject);
        assertion = await jwt.sign(await key);
      } catch (error) {
        key = null;
        throw new ExternalCallFailedError('google_oauth', 'token', {
          message: `服务账号私钥无法签名：${error instanceof Error ? error.message : String(error)}`,
          retryable: false,
          cause: error,
        });
      }
      const body = await http.postForm(
        credentials.tokenUri,
        { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion },
        // 返回的是访问令牌：调用记录里不留响应体
        { operation: 'oauth2.token', secretResponse: true },
      );
      const parsed = tokenSchema.safeParse(body);
      if (!parsed.success) {
        throw new ExternalCallFailedError('google_oauth', 'token', {
          message: '换令牌返回的内容不对',
          retryable: false,
        });
      }
      cache.set(keyOf(scope, subject), {
        value: parsed.data.access_token,
        expiresAt: now() + parsed.data.expires_in * 1000,
      });
      return parsed.data.access_token;
    },
    forget(scope, subject) {
      cache.delete(keyOf(scope, subject));
    },
  };
}
