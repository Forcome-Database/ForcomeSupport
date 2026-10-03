/**
 * 乐观锁冲突（规格「数据约定」）：带 version 的更新没有命中行，说明别人先保存了。
 * 接口统一返回 409，前端按 G7「乐观锁冲突」提示（保留输入，「查看最新」或「覆盖保存」）。
 */
export class OptimisticLockError extends Error {
  override name = 'OptimisticLockError';
  readonly objectType: string;
  readonly objectId: string;

  constructor(objectType: string, objectId: string) {
    super(`${objectType} ${objectId} 已被他人修改`);
    this.objectType = objectType;
    this.objectId = objectId;
  }
}
