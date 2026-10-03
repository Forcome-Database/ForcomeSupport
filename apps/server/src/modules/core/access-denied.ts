/**
 * 没有访问权限（接口统一返回 403 forbidden）：没有这项能力（PRD 10.1），或要访问的数据不在成员的店铺范围内。
 * 越权访问（E-24）的审计由抛出方在抛出前写好（org 的访问上下文），这里只负责把请求拒掉；
 * message 是可以直接显示的中文说明。
 */
export class AccessDeniedError extends Error {
  override name = 'AccessDeniedError';

  constructor(message = '没有访问权限') {
    super(message);
  }
}
