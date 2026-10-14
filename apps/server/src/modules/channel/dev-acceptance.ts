import { getDemoFixture } from '@forcome/fixtures';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { defineJob, transaction, type AppEnv, type JobContext, type Runtime } from '../core';
import { gmailClient, reportAcceptanceMails, type IntegrationClients } from '../integration';

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

/** worker：把验收夹具的来信投进本进程的 Fake Gmail（生产环境拒绝：FakeNotAllowedError） */
export function deliverReportAcceptance(
  clients: IntegrationClients,
  { logger }: Pick<JobContext, 'logger'>,
): void {
  const gmail = clients.fake(gmailClient);
  const mails = reportAcceptanceMails(getDemoFixture());
  for (const { mail } of mails) gmail.deliver(mail);
  logger.info({ mails: mails.length }, '验收夹具：已投入报表验收日的来信');
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
