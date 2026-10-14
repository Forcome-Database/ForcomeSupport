// 宿主机检查（待办 28；ADR 0013 修订「worker 存活检查」，协调者 2026-10-14 决定 Q1–Q4；docs/运维手册.md 第 6 节）：
// 不经 worker、由宿主机每分钟执行一次（systemd 定时器模板 deploy/host/，或 node deploy/deploy.mjs <环境> host-check），
// 看 worker 容器在不在运行、worker 写的心跳（core.worker_heartbeat，每分钟的自检任务写）有没有停，异常发钉钉群机器人。
// 这里只放判断与写法（纯函数，有单测）；取 Docker 与数据库状态、读写状态文件、发消息在 deploy.mjs。
// 去重与再提醒同 worker 自检（apps/server/src/modules/core/alerts.ts）：按键、持续每 ALERT_REPEAT_HOURS 再提醒、恢复发「已恢复」。

/** 消息开头的环境名（同应用里的 alertBrand） */
const ENVIRONMENT_LABELS = {
  production: '生产',
  staging: '开发测试',
  development: '本机',
  test: '测试',
};

export function hostAlertBrand(appEnv) {
  return `【Forcome Support · ${ENVIRONMENT_LABELS[appEnv] ?? appEnv}】`;
}

const shanghai = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** 北京时间「月-日 时:分」 */
export function hostTime(instant) {
  const part = (type) => shanghai.formatToParts(instant).find((p) => p.type === type)?.value;
  return `${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;
}

/** 各异常项在标题里的叫法 */
const TITLES = {
  'worker:down': 'worker 已停止',
  'worker:heartbeat': 'worker 心跳停止',
  'database:unreachable': '数据库连不上',
};

/**
 * @typedef {object} HostObservation
 * @property {string | null} workerState worker 容器的状态（running、paused、exited、restarting…）；没有容器为 null
 * @property {Date | null} workerStartedAt worker 容器这次启动的时刻
 * @property {boolean} databaseReachable 能不能在数据库容器里查到心跳
 * @property {string | null} databaseError 查不到时的原因
 * @property {Date | null} heartbeatAt 心跳的时刻（数据库时间）；还没有心跳为 null
 * @property {Date} now 数据库的此刻（与心跳同一个时钟）；连不上时为本机此刻
 * @property {'pending' | 'replaying' | 'live' | 'none' | null} cutover 上线切换的状态：回放中 worker 是被有意停掉的
 */

/**
 * 这次检查发现的异常。回放中（上线切换，worker 被有意停掉）不判断 worker（待办 26 的衔接）
 * @param {HostObservation} observed
 * @param {{ heartbeatMinutes: number }} settings
 * @returns {{ key: string, subject: string, problem: string }[]}
 */
export function hostFindings(observed, settings) {
  const findings = [];
  if (!observed.databaseReachable) {
    findings.push({
      key: 'database:unreachable',
      subject: '数据库',
      problem: `连不上，读不到 worker 心跳（${observed.databaseError ?? '原因不明'}）`,
    });
  }
  if (observed.cutover === 'replaying') return findings;

  if (observed.workerState !== 'running' && observed.workerState !== 'paused') {
    findings.push({
      key: 'worker:down',
      subject: 'worker',
      problem: observed.workerState
        ? `容器不在运行（状态 ${observed.workerState}）`
        : '没有 worker 容器（没部署或被删掉了）',
    });
    return findings;
  }
  if (!observed.databaseReachable) return findings;

  const limitMs = settings.heartbeatMinutes * 60_000;
  const paused = observed.workerState === 'paused' ? '；容器处于暂停状态' : '';
  if (observed.heartbeatAt) {
    if (observed.now.getTime() - observed.heartbeatAt.getTime() > limitMs) {
      findings.push({
        key: 'worker:heartbeat',
        subject: 'worker',
        problem: `进程在，但心跳超过 ${settings.heartbeatMinutes} 分钟没有更新（最近 ${hostTime(observed.heartbeatAt)}${paused}）`,
      });
    }
  } else if (
    observed.workerStartedAt &&
    observed.now.getTime() - observed.workerStartedAt.getTime() > limitMs
  ) {
    findings.push({
      key: 'worker:heartbeat',
      subject: 'worker',
      problem: `进程在，但启动 ${settings.heartbeatMinutes} 分钟后还没有心跳${paused}`,
    });
  }
  return findings;
}

/**
 * 与上次的状态（状态文件，键 → { subject, problem, firingSince, notifiedAt }）比较，决定发什么、记什么
 * @param {{ key: string, subject: string, problem: string }[]} findings
 * @param {Record<string, { subject: string, problem: string, firingSince: string, notifiedAt: string }>} state
 * @param {Date} now
 * @param {number} repeatMs
 */
export function planHostAlerts(findings, state, now, repeatMs) {
  const firing = [];
  let due = false;
  for (const finding of findings) {
    const before = state[finding.key];
    if (!before) {
      firing.push({ ...finding, firingSince: now, isNew: true });
      due = true;
    } else {
      firing.push({ ...finding, firingSince: new Date(before.firingSince), isNew: false });
      if (now.getTime() - Date.parse(before.notifiedAt) >= repeatMs) due = true;
    }
  }
  const keys = new Set(findings.map((f) => f.key));
  const resolved = Object.entries(state)
    .filter(([key]) => !keys.has(key))
    .map(([key, value]) => ({ key, ...value, firingSince: new Date(value.firingSince) }));
  const send = due || resolved.length > 0;
  /** 发出去之后要记的状态 */
  const nextState = Object.fromEntries(
    firing.map((item) => [
      item.key,
      {
        subject: item.subject,
        problem: item.problem,
        firingSince: item.firingSince.toISOString(),
        notifiedAt: now.toISOString(),
      },
    ]),
  );
  return { firing, resolved, send, nextState };
}

/**
 * 消息：标题写异常项（「worker 已停止」「worker 心跳停止」），只有恢复时写「已恢复：…」；维护标记过期时注明
 * @param {ReturnType<typeof planHostAlerts>} plan
 * @param {{ appEnv: string, now: Date, expiredMaintenance: { reason: string, until: string } | null }} context
 */
export function formatHostAlert(plan, { appEnv, now, expiredMaintenance }) {
  const brand = hostAlertBrand(appEnv);
  const label = (key) => TITLES[key] ?? key;
  const title =
    plan.firing.length > 0
      ? `${brand}${plan.firing.map((f) => label(f.key)).join('、')}`
      : `${brand}已恢复：${plan.resolved.map((r) => label(r.key)).join('、')}`;
  const lines = [`#### ${title}`, ''];
  for (const item of plan.firing) {
    lines.push(
      item.isNew
        ? `- **新** ${item.subject}：${item.problem}`
        : `- ${item.subject}：${item.problem}（持续中，自 ${hostTime(item.firingSince)}）`,
    );
  }
  if (plan.resolved.length > 0) {
    if (plan.firing.length > 0) lines.push('');
    lines.push('**已恢复**', '');
    for (const item of plan.resolved) {
      lines.push(`- ${label(item.key)}（异常自 ${hostTime(item.firingSince)}）`);
    }
  }
  if (expiredMaintenance) {
    lines.push(
      '',
      `维护标记已过期（${expiredMaintenance.reason}，到期 ${hostTime(new Date(expiredMaintenance.until))}）`,
    );
  }
  lines.push('', `宿主机检查 ${hostTime(now)} · 处理见运维手册`);
  return { title, markdown: lines.join('\n') };
}

/**
 * 数据库里一次查出的心跳与切换状态（deploy.mjs 用 psql -At 查，一行：心跳时刻|数据库此刻|切换状态）
 * @param {string} line
 */
export function parseHeartbeatRow(line) {
  const [beat, now, cutover] = line.trim().split('|');
  return {
    heartbeatAt: beat ? new Date(beat) : null,
    now: new Date(now),
    cutover: /** @type {'pending' | 'replaying' | 'live' | 'none'} */ (cutover || 'none'),
  };
}

/** 查心跳与切换状态的 SQL（channel.mail_cutover 没有行为 none；回放中 completed_at 为空） */
export const HEARTBEAT_SQL = `SELECT
  coalesce((SELECT to_char(beat_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') FROM core.worker_heartbeat WHERE id = 'worker'), ''),
  to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  coalesce((SELECT CASE WHEN completed_at IS NULL THEN 'replaying' ELSE 'live' END FROM channel.mail_cutover LIMIT 1), 'none')`;
