import { SYNC_DELAY_MS, syncConnectionStatus } from '@forcome/contracts';
import { syncAlertProblem, type SelfCheckProbe } from '../core';
import { dingtalkSyncHealth } from './dingtalk-sync';

/*
 * worker 自检的钉钉通讯录一项（待办 28，PRD 6.9、待办 05 留下的衔接）：按全量对账的同步记录（org.dingtalk_sync），
 * 超过 2 小时没对账成功（同步延迟）或连续 3 次失败（连接异常）告警；还没对账过不告警。
 * 产品上钉钉的异常只在 P18 钉钉卡显示、只提醒管理员（E-32），运维群的告警是另一个通道。
 */
export const orgSelfCheckProbe: SelfCheckProbe = {
  name: '钉钉通讯录同步',
  async check({ db, now }) {
    const health = await dingtalkSyncHealth(db);
    const problem = syncAlertProblem(
      syncConnectionStatus(health, SYNC_DELAY_MS.dingtalk, now),
      health,
      SYNC_DELAY_MS.dingtalk,
    );
    return problem ? [{ key: 'sync:dingtalk', subject: '钉钉通讯录', problem }] : [];
  },
};
