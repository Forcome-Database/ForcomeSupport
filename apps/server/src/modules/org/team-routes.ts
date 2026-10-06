import {
  apiErrorSchema,
  teamCandidatesSchema,
  teamMemberAddSchema,
  teamMemberSchema,
  teamSaveSchema,
  teamSchema,
} from '@forcome/contracts';
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { transaction, type AppEnv, type Runtime } from '../core';
import { requireCapability, requireSession, type AccessVariables } from './access';
import { forbidden, json, unauthenticated } from './openapi';
import {
  addTeamMember,
  listTeam,
  listTeamCandidates,
  saveTeam,
  type TeamStoreChoices,
} from './team';

/*
 * P20 团队与权限的接口（PRD P20「第一阶段」，待办 06）：只有管理员（settings.channels_team：「成员与角色、店铺数据范围（P20）」）。
 */

const invalid = json(apiErrorSchema, '字段填错（fields 为各字段的说明）');

const teamRoute = createRoute({
  method: 'get',
  path: '/api/org/team',
  summary: 'P20 成员表：已分配角色的成员、授权可选的全部店铺、钉钉通讯录最近一次对账成功的时刻',
  responses: {
    200: json(teamSchema, '成员表'),
    401: unauthenticated,
    403: forbidden,
  },
});

const candidatesRoute = createRoute({
  method: 'get',
  path: '/api/org/team/candidates',
  summary: '「从钉钉添加」可选的人：钉钉通讯录里在职、还没分配角色的成员',
  responses: {
    200: json(teamCandidatesSchema, '可添加的人'),
    401: unauthenticated,
    403: forbidden,
  },
});

const addRoute = createRoute({
  method: 'post',
  path: '/api/org/team/members',
  summary: '从钉钉添加成员：选人并分配角色与店铺数据范围（都必填，记审计「添加成员」）',
  request: {
    body: { content: { 'application/json': { schema: teamMemberAddSchema } }, required: true },
  },
  responses: {
    201: json(teamMemberSchema, '已添加'),
    400: invalid,
    401: unauthenticated,
    403: forbidden,
    409: json(apiErrorSchema, '选的人刚被钉钉同步改过（例如离职停用），请重新选择'),
  },
});

const saveRoute = createRoute({
  method: 'put',
  path: '/api/org/team',
  summary: '吸底保存栏的保存：这次改过的成员的角色与店铺范围一起保存（K6），返回最新的成员表',
  request: {
    body: { content: { 'application/json': { schema: teamSaveSchema } }, required: true },
  },
  responses: {
    200: json(teamSchema, '已保存'),
    400: invalid,
    401: unauthenticated,
    403: forbidden,
    409: json(apiErrorSchema, '有成员已被别人修改（G7），整批都没有保存'),
  },
});

export function createTeamRoutes(deps: {
  runtime: Runtime;
  appEnv: AppEnv;
  storeChoices: TeamStoreChoices;
}) {
  const { runtime, appEnv, storeChoices } = deps;
  const routes = new OpenAPIHono<{ Variables: AccessVariables }>();
  for (const path of ['/api/org/team', '/api/org/team/*']) {
    routes.use(path, requireSession(runtime, appEnv), requireCapability('settings.channels_team'));
  }

  routes.openapi(teamRoute, async (c) =>
    c.json(await listTeam(runtime.db, storeChoices, runtime.clock.now()), 200),
  );

  routes.openapi(candidatesRoute, async (c) =>
    c.json({ candidates: await listTeamCandidates(runtime.db) }, 200),
  );

  routes.openapi(addRoute, async (c) => {
    const input = c.req.valid('json');
    const actor = c.get('access').actor;
    const added = await transaction(runtime, (tx) => addTeamMember(tx, actor, input, storeChoices));
    return c.json(added, 201);
  });

  routes.openapi(saveRoute, async (c) => {
    const { changes } = c.req.valid('json');
    const actor = c.get('access').actor;
    await transaction(runtime, (tx) => saveTeam(tx, actor, changes, storeChoices));
    return c.json(await listTeam(runtime.db, storeChoices, runtime.clock.now()), 200);
  });

  return routes;
}
