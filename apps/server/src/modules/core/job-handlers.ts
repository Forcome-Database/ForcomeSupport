import { syncExchangeRates, syncExchangeRatesJob, type ExchangeRateSource } from './exchange-rates';
import { handleJob, type AnyJobHandler } from './jobs';
import {
  sendDueWorkNotifications,
  sendWorkNotificationsJob,
  type WorkNotificationSender,
} from './work-notifications';

/**
 * core 的任务处理器。要用外部系统的由入口给出（core 不依赖 integration，ADR 0009 修订）：
 * 汇率来源是 integration 的 exchangeRateClient，发工作通知的是钉钉客户端；测试里都是 Fake。
 */
export function createCoreJobHandlers(deps: {
  exchangeRates: () => ExchangeRateSource;
  workNotifications: () => WorkNotificationSender;
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
  ];
}
