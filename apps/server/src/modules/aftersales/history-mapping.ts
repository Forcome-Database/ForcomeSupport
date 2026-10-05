import {
  aftersalesStatusLabels,
  claimStatusLabels,
  claimTargetLabels,
  currencies,
  feeItemLabels,
  handlingMethodLabels,
  responsibilityLabels,
  shipperLabels,
  sites,
} from '@forcome/contracts';
import { z } from 'zod';
import defaultMappingJson from './history-mapping.json' with { type: 'json' };

/*
 * 售后登记表导入的字段映射表（PRD 第 14 节、R-AS-08，待办 27）：原表的哪一列是售后单的哪个字段，原表的写法对应哪个取值。
 * 映射表单独成文件（history-mapping.json，随镜像打包；导入命令可用 --mapping 换一份），拿到客户的真实登记表后只改它、
 * 不改代码。格式由下面的 historyMappingSchema 校验，写错的列名、取值在导入前就报出来。
 */

/** 导入整体做不下去（映射表不对、表头缺列、文件读不了）：不导入任何一行，报错说明原因 */
export class HistoryImportError extends Error {
  override readonly name = 'HistoryImportError';
}

/** 比较取值用的写法：去首尾空白、连续空白合成一个、不分大小写 */
export function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** 比较表头用的写法：去掉全部空白（表头里常有换行与空格）、不分大小写 */
export function normalizeHeader(text: string): string {
  return text.replace(/\s+/g, '').toLowerCase();
}

const identity = <K extends string>(keys: readonly K[]) =>
  Object.fromEntries(keys.map((key) => [key, key])) as unknown as Record<K, string>;

/**
 * 有固定取值的字段：原表写标识（completed）或中文叫法（已完成）都认，其余写法在映射表 values 里配别名。
 * feeItem 是取消时保留的费用项（keptFees 列里写费用项的叫法）。
 */
export const historyEnumLabels = {
  site: identity(sites),
  status: aftersalesStatusLabels,
  method: handlingMethodLabels,
  responsibility: responsibilityLabels,
  shipper: shipperLabels,
  claimTarget: claimTargetLabels,
  claimStatus: claimStatusLabels,
  currency: identity(currencies),
  feeItem: feeItemLabels,
} as const;
export type HistoryEnumKind = keyof typeof historyEnumLabels;

/** 按标识或中文叫法认一个固定取值（不分大小写）；认不出为 undefined */
export function enumByText<K extends string>(
  labels: Readonly<Record<K, string>>,
  text: string,
): K | undefined {
  const wanted = normalizeText(text);
  return (Object.keys(labels) as K[]).find(
    (key) => normalizeText(key) === wanted || normalizeText(labels[key]) === wanted,
  );
}

const header = z.string().trim().min(1, '列名不能为空');
/** 费用项可以由几列相加（例如原表分「退款金额」「补偿金额」两列，都记在额外赔偿，R-AS-08） */
const headers = z.union([header, z.array(header).min(1)]);
/** 别名：原表的写法 → 标准取值（固定取值写标识或中文叫法；店铺写店铺名，生产厂写代码，负责人写成员姓名） */
const aliases = z.record(z.string().trim().min(1), z.string().trim().min(1));

export const historyMappingSchema = z
  .strictObject({
    /** 说明（导入不读） */
    $comment: z.array(z.string()).optional(),
    /** 工作表名；不写取第一张（CSV 没有工作表） */
    sheet: header.optional(),
    /** 表头在第几行（从 1 起） */
    headerRow: z.int().min(1).default(1),
    /** 行标识：哪几列合起来能唯一认出原表的一行（重跑时据此跳过已导入的行，幂等） */
    rowKey: z.array(header).min(1),
    /** 售后单的字段 → 原表的列名；原表没有的字段不写（导入后算缺，可补登） */
    columns: z.strictObject({
      /** 原登记日期：售后单号的日期取它；原表没有费用发生日时也按它取汇率并作费用发生日 */
      registeredDate: header,
      feeDate: header.optional(),
      status: header.optional(),
      /** 完成时间（已完成的单） */
      completedAt: header.optional(),
      /** 取消原因、取消时间、取消时保留的费用项（已取消的单；保留项没有时按全部保留） */
      cancelReason: header.optional(),
      cancelledAt: header.optional(),
      keptFees: header.optional(),
      store: header,
      site: header.optional(),
      orderNumber: header.optional(),
      customerName: header.optional(),
      /** 原表的登记人（只记姓名） */
      registeredBy: header.optional(),
      /** 负责人：按姓名认有该店铺数据范围的售后负责人 */
      owner: header.optional(),
      method: header.optional(),
      responsibility: header.optional(),
      responsibilityReason: header.optional(),
      factory: header.optional(),
      /** 工厂承担比例：一列（三组相同）或三组各一列，0–100 的整数 */
      factoryPct: header.optional(),
      productFactoryPct: header.optional(),
      freightFactoryPct: header.optional(),
      otherFactoryPct: header.optional(),
      partSku: header.optional(),
      partQuantity: header.optional(),
      shipper: header.optional(),
      carrier: header.optional(),
      shipDate: header.optional(),
      trackingNumber: header.optional(),
      claimTarget: header.optional(),
      claimStatus: header.optional(),
      /** 原币（一行一个币种）；原表没有时按美元导入并标注 */
      currency: header.optional(),
      productCost: headers.optional(),
      freight: headers.optional(),
      /** 额外赔偿：原表的退款或补偿金额映射到这里（R-AS-08） */
      compensation: headers.optional(),
      otherCost: headers.optional(),
    }),
    values: z
      .strictObject({
        store: aliases.optional(),
        site: aliases.optional(),
        status: aliases.optional(),
        method: aliases.optional(),
        responsibility: aliases.optional(),
        shipper: aliases.optional(),
        claimTarget: aliases.optional(),
        claimStatus: aliases.optional(),
        currency: aliases.optional(),
        feeItem: aliases.optional(),
        factory: aliases.optional(),
        owner: aliases.optional(),
      })
      .default({}),
    defaults: z
      .strictObject({
        /** 原表没写状态时的状态（真实表到位后再定，待办 32） */
        status: z.string().trim().min(1).optional(),
      })
      .default({}),
  })
  .superRefine((mapping, ctx) => {
    const { columns } = mapping;
    const groups = [columns.productFactoryPct, columns.freightFactoryPct, columns.otherFactoryPct];
    if (columns.factoryPct && groups.some(Boolean)) {
      ctx.addIssue({
        code: 'custom',
        path: ['columns', 'factoryPct'],
        message: '工厂承担比例写一列（factoryPct）或三组各一列，不能都写',
      });
    }
    if (!columns.factoryPct && groups.some(Boolean) && !groups.every(Boolean)) {
      ctx.addIssue({
        code: 'custom',
        path: ['columns', 'productFactoryPct'],
        message: '三组工厂承担比例要么都写、要么都不写',
      });
    }
    // 固定取值的别名与默认状态，指向的标准取值必须认得出（写错了导入前就报，不等到逐行报错）
    for (const kind of Object.keys(historyEnumLabels) as HistoryEnumKind[]) {
      for (const [alias, target] of Object.entries(mapping.values[kind] ?? {})) {
        const labels: Readonly<Record<string, string>> = historyEnumLabels[kind];
        if (enumByText(labels, target) === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: ['values', kind, alias],
            message: `「${target}」不是可用的取值`,
          });
        }
      }
    }
    const status = mapping.defaults.status;
    if (status && enumByText(historyEnumLabels.status, status) === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['defaults', 'status'],
        message: `「${status}」不是售后单的状态`,
      });
    }
  });

export type HistoryMapping = z.output<typeof historyMappingSchema>;
export type HistoryColumns = HistoryMapping['columns'];

/** 读映射表（JSON 已解析）；不合格式时抛 HistoryImportError，逐条写明哪里不对 */
export function parseHistoryMapping(json: unknown, source: string): HistoryMapping {
  const parsed = historyMappingSchema.safeParse(json);
  if (!parsed.success) {
    throw new HistoryImportError(`映射表 ${source} 不对：\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

/** 随镜像打包的映射表（history-mapping.json）；用时才校验，写坏了只影响导入命令 */
export function defaultHistoryMapping(): HistoryMapping {
  return parseHistoryMapping(defaultMappingJson, 'history-mapping.json');
}
