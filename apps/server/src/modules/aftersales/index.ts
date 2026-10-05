// aftersales：售后单与登记台账；比例协商、内部结算（ADR 0005；第一期只有台账）。
// 其他模块只能经本文件调用本模块，不能引用内部文件或读写本模块的表。
export { aftersalesLedgerFixtureStep } from './fixtures';
export { importAftersalesHistory, type HistoryImportReport } from './history-import';
export {
  defaultHistoryMapping,
  HistoryImportError,
  parseHistoryMapping,
  type HistoryMapping,
} from './history-mapping';
export { formatHistoryImportReport } from './history-report';
export { readHistorySheet, type HistoryCell, type HistorySheet } from './history-sheet';
export { createAftersalesRoutes } from './routes';
