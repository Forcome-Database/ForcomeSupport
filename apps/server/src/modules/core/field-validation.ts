import type { FieldErrors } from '@forcome/contracts';

/**
 * 表单字段填错（K8 等：错误写在字段下方，保存后定位到第一个错误）。各模块的保存逻辑在判断出全部错误后抛它，
 * 接口统一返回 400 `{ error: 'invalid_request', message, fields }`，fields 的形状见 contracts 的 FieldErrors。
 */
export class FieldValidationError extends Error {
  override name = 'FieldValidationError';
  /** 字段路径 → 写在字段下方的中文说明 */
  readonly fields: Readonly<FieldErrors>;

  constructor(fields: Readonly<FieldErrors>) {
    super('请按提示修改后再保存');
    this.fields = fields;
  }
}
