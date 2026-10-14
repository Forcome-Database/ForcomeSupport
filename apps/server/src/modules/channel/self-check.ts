import { SYNC_DELAY_MS, type Platform } from '@forcome/contracts';
import { syncAlertProblem, type AlertFinding, type SelfCheckProbe } from '../core';
import { orderSyncStatus } from '../order';
import { loadConnections } from './connections';
import { mailboxStatus } from './mailbox-health';
import { mailCutoverStatus } from './mail-cutover';
import { listAllStores } from './stores';

/*
 * worker 自检的渠道一项（待办 28，PRD 6.9）：P18 渠道卡同一套状态——每个进线邮箱的 Gmail 同步、每个订单店铺的增量同步，
 * 同步延迟（Gmail、订单 10 分钟）与连接异常（连续 3 次失败）告警，未连接（没配置凭据、还没同步过）不告警。
 * Gmail 在上线切换完成前（生产「待切换」「回放中」，待办 26）不告警：那时实时收信是关着的（协调者 2026-10-14 决定 Q2）。
 * 订单通知队列（SQS）与回补、对账在 order 的自检项里。
 */

const PLATFORM_LABELS: Record<Platform, string> = { amazon: '亚马逊订单', shopify: 'Shopify 订单' };

export const channelSelfCheckProbe: SelfCheckProbe = {
  name: '渠道同步',
  async check({ db, now, appEnv }) {
    const stores = await listAllStores(db);
    const snapshot = await loadConnections(db, now);
    const findings: AlertFinding[] = [];

    if ((await mailCutoverStatus(db, appEnv)) === 'live') {
      const addresses = [...new Set(stores.flatMap((store) => store.mailboxes))].sort();
      for (const address of addresses) {
        const health = snapshot.mailboxes.get(address) ?? {
          lastSuccessAt: null,
          consecutiveFailures: 0,
          failingSince: null,
        };
        const problem = syncAlertProblem(mailboxStatus(health, now), health, SYNC_DELAY_MS.gmail);
        if (problem) {
          findings.push({ key: `gmail:${address}`, subject: `Gmail ${address}`, problem });
        }
      }
    }

    for (const store of stores) {
      const health = snapshot.orders[store.platform].get(store.id) ?? {
        lastSuccessAt: null,
        consecutiveFailures: 0,
        failingSince: null,
      };
      const problem = syncAlertProblem(orderSyncStatus(health, now), health, SYNC_DELAY_MS.orders);
      if (problem) {
        findings.push({
          key: `orders:${store.id}`,
          subject: `${PLATFORM_LABELS[store.platform]} ${store.name}`,
          problem,
        });
      }
    }
    return findings;
  },
};
