import type { AlertSender } from './alerts';
import type { AlertSettings, AppEnv } from './config';
import { syncExchangeRates, syncExchangeRatesJob, type ExchangeRateSource } from './exchange-rates';
import { handleJob, type AnyJobHandler } from './jobs';
import { coreSelfCheckProbes, runSelfCheck, selfCheckJob, type SelfCheckProbe } from './self-check';
import {
  sendDueWorkNotifications,
  sendWorkNotificationsJob,
  type WorkNotificationSender,
} from './work-notifications';

/**
 * core 的任务处理器。要用外部系统的由入口给出（core 不依赖 integration，ADR 0009 修订）：
 * 汇率来源是 integration 的 exchangeRateClient，发工作通知的是钉钉客户端，发告警的是钉钉群机器人；测试里都是 Fake。
 * 每分钟自检（待办 28）除了 core 自己的自检项，另跑入口交进来的各模块的自检项（selfCheck.probes）。
 */
export function createCoreJobHandlers(deps: {
  exchangeRates: () => ExchangeRateSource;
  workNotifications: () => WorkNotificationSender;
  selfCheck: {
    readonly alerts: () => AlertSender;
    readonly probes: readonly SelfCheckProbe[];
    readonly appEnv: AppEnv;
    readonly settings: AlertSettings;
  };
}): AnyJobHandler[] {
  return [
    handleJob(syncExchangeRatesJob, async (_payload, context) => {
      const report = await syncExchangeRates(context.runtime, deps.exchangeRates(), context.logger);
      context.logger.info(report, '汇率已同步');
    }),
    handleJob(sendWorkNotificationsJob, async (_payload, context) => {
      const report = await sendDueWorkNotifications(
        context.runtime,
        deps.workNotifications(),
        context,
      );
      if (report.sent > 0 || report.failed > 0) {
        context.logger.info(report, '钉钉工作通知已发送');
      }
    }),
    handleJob(selfCheckJob, async (_payload, context) => {
      const { alerts, probes, appEnv, settings } = deps.selfCheck;
      await runSelfCheck(
        context.runtime,
        { probes: [...coreSelfCheckProbes, ...probes], sender: alerts(), appEnv, settings },
        context,
      );
    }),
  ];
}
