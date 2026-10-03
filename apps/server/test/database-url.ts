/** 测试用 PostgreSQL 的管理连接；默认是本机 docker-compose.dev.yml 起的库 */
export const TEST_ADMIN_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://forcome:forcome@127.0.0.1:4520/forcome';

/** 同一实例上另一个库的连接串 */
export function databaseUrl(database: string): string {
  const url = new URL(TEST_ADMIN_URL);
  url.pathname = `/${database}`;
  return url.toString();
}
