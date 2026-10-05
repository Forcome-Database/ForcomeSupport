// factory：生产厂、SKU 归属、工厂任务、留言（ADR 0005；第一期只有生产厂与 SKU 归属，供台账用，其余第二期起）。
// 其他模块只能经本文件调用本模块，不能引用内部文件或读写本模块的表。
export { listFactories, listParts, type FactoryOption, type PartOption } from './catalog';
export { factoryPartsFixtureStep } from './fixtures';
