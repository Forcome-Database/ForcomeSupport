import { getDemoFixture } from '@forcome/fixtures';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { inArray } from 'drizzle-orm';
import { defineJob, transaction, type AppEnv, type JobContext, type Runtime } from '../core';
import {
  fixtureMailboxProvider,
  gmailClient,
  imapClient,
  imapFolderRoles,
  reportAcceptanceMails,
  type IntegrationClients,
} from '../integration';
import { gmailSyncJob } from './gmail-sync';
import { imapSyncJob } from './imap-sync';
import { mailboxSync } from './schema';

/*
 * AC-P1-14 的验收夹具（待办 24）：在验收日（示例的 09-10）投 73 封客户来信（亚马逊 52、Shopify 与邮件 21，integration 的
 * reportAcceptanceMails），归并后 P17「每日工单量」那天的柱为 73、下钻到 P04 列出 73 张。示例工单里那天只有几张，所以另投。
 * Playwright（本机与开发测试环境的冒烟）经开发接口触发：收信与归并在 worker 里，api 与 worker 各有一份 Fake Gmail，
 * 所以接口只排一个任务，由 worker 把信投进它的 Fake Gmail，照常经推送、同步、归并成工单。Gmail 消息 ID 带验收日，重复投递去重。
 * 只在开启开发登录的非生产环境挂上接口（app.ts）；生产环境用不了 Fake，任务即便排进来也会失败。
 */

/** 投验收夹具的来信（只在非生产环境由开发接口排入） */
export const reportAcceptanceJob = defineJob('channel.report_acceptance', z.object({}), {
  retryLimit: 0,
});

/**
 * worker：把验收夹具的来信投进本进程的 Fake 邮箱（按邮箱的服务商：Fake Gmail 或 Fake IMAP，待办 35；生产环境拒绝：FakeNotAllowedError），
 * 再给这几个邮箱各排一次同步。
 * 开发测试环境长期运行：worker 重启后 Fake 的历史号从头数，库里却记着上一个进程的游标，所以投信前先让 Fake 接上库里的游标
 * （否则新到的信历史号比游标小，增量同步取不到；Fake IMAP 同理接上 UIDVALIDITY 与 UID）；重启后的 Fake 邮箱也没有 watch、不会推送，所以直接排同步
 */
export async function deliverReportAcceptance(
  clients: IntegrationClients,
  { runtime, logger }: Pick<JobContext, 'runtime' | 'logger'>,
): Promise<void> {
  const gmail = clients.fake(gmailClient);
  const imap = clients.fake(imapClient);
  const fixture = getDemoFixture();
  const mails = reportAcceptanceMails(fixture);
  const mailboxes = [...new Set(mails.map((m) => m.mailbox.toLowerCase()))];
  const qiye = new Set(mailboxes.filter((m) => fixtureMailboxProvider(fixture, m) === 'qiye163'));
  const cursors = await runtime.db
    .select({
      address: mailboxSync.address,
      historyId: mailboxSync.historyId,
      imapCursor: mailboxSync.imapCursor,
    })
    .from(mailboxSync)
    .where(inArray(mailboxSync.address, mailboxes));
  for (const { address, historyId, imapCursor } of cursors) {
    if (historyId) gmail.continueHistoryFrom(address, Number(historyId));
    for (const role of imapFolderRoles) {
      const cursor = imapCursor?.[role];
      if (cursor) imap.continueFrom(address, role, cursor);
    }
  }
  for (const { mailbox, mail } of mails) {
    if (qiye.has(mailbox.toLowerCase())) imap.deliver(mail);
    else gmail.deliver(mail);
  }
  await transaction(runtime, async (tx) => {
    for (const mailbox of mailboxes) {
      const job = qiye.has(mailbox) ? imapSyncJob : gmailSyncJob;
      await tx.enqueue(job, { mailbox }, { singletonKey: mailbox });
    }
  });
  logger.info({ mails: mails.length, mailboxes }, '验收夹具：已投入报表验收日的来信');
}

const acceptanceRoute = createRoute({
  method: 'post',
  path: '/api/dev/report-acceptance',
  summary:
    'AC-P1-14 的验收夹具：排一个任务，由 worker 在验收日投 73 封客户来信（只在非生产环境开启开发登录时存在；重复调用不会多出工单）',
  responses: {
    202: {
      description: '已排入，返回验收日与来信封数（归并成工单要等 worker 收信）',
      content: {
        'application/json': {
          schema: z.object({ date: z.iso.date(), letters: z.int() }),
        },
      },
    },
  },
});

export function createDevAcceptanceRoutes(deps: { runtime: Runtime; appEnv: AppEnv }) {
  const { runtime, appEnv } = deps;
  if (appEnv === 'production') {
    throw new Error('生产环境不能投验收夹具');
  }
  const routes = new OpenAPIHono();
  routes.openapi(acceptanceRoute, async (c) => {
    await transaction(runtime, (tx) => tx.enqueue(reportAcceptanceJob, {}));
    const { date, amazon, shopifyEmail } = getDemoFixture().reportAcceptance;
    return c.json({ date, letters: amazon + shopifyEmail }, 202);
  });
  return routes;
}
