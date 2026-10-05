// 生成售后登记表的合成样本 register-sample.xlsx（待办 27）：pnpm --filter @forcome/server history:sample。
// 样本内容在 test/fixtures/history-import/sample.ts，改了它就重新生成并提交；test/history-import-sample.test.ts 核对两者一致。
import { SAMPLE_FILE, sampleWorkbook } from '../test/fixtures/history-import/sample';

await sampleWorkbook().xlsx.writeFile(SAMPLE_FILE);
console.log(`已生成 ${SAMPLE_FILE}`);
