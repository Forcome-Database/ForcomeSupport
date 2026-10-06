import type { ChannelAlert } from '@forcome/contracts';

/*
 * 全站横幅（G4 集成中断，K7 同一写法，待办 09 Q1 用户确认）的文案：逐字照原型 GlobalStates 的 G4、StatesAdmin 的 K7 与 K20 补充小样，
 * channel-alert-copy.test.ts 读原型生成物核对。时刻是这串连续失败的第 1 次（几个邮箱或店铺同时异常时取最早的一个），写「月-日 时:分」。
 * Gmail（09）、Shopify 订单（11）与亚马逊订单（12，协调者 2026-10-06 决定，套用 Gmail 的写法）；ChannelAlert 的 kind 加了渠道时这里跟着补
 * （类型上漏了会报错）。几条同时出现时按接口给的顺序上下叠放（Gmail、亚马逊、Shopify）。
 */
export const CHANNEL_ALERT_COPY: Record<
  ChannelAlert['kind'],
  { readonly title: string; readonly description: (since: string) => string }
> = {
  gmail: {
    title: 'Gmail 连接中断，来信暂存队列',
    description: (since) =>
      `${since} 起未收取。恢复后自动补收，按到达顺序处理，SLA 从原到达时间计算。管理员、客服主管已收到通知。`,
  },
  amazon: {
    title: '亚马逊订单同步中断',
    description: (since) =>
      `${since} 起未同步。来信照常收取，恢复后自动补拉订单。管理员、客服主管已收到通知。`,
  },
  shopify: {
    title: 'Shopify 订单同步中断',
    description: (since) =>
      `${since} 起未同步。来信照常收取，恢复后自动补拉订单。管理员、客服主管已收到通知。`,
  },
};

/** 横幅右侧的按钮：进 P18，只对管理员显示（G4） */
export const VIEW_CHANNEL_STATUS = '查看渠道状态';
