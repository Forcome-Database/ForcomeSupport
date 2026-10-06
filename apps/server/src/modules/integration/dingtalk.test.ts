import { getDemoFixture } from '@forcome/fixtures';
import { MockAgent } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createRealDingtalkClient,
  DingtalkAuthCodeError,
  FakeDingtalk,
  type DingtalkClient,
} from './dingtalk';
import { factoryHeadUserId, fixtureDirectory } from './dingtalk-replay';
import { ackFrame, parseStreamFrame, type DingtalkStream } from './dingtalk-stream';
import { ExternalCallFailedError } from './faults';
import { createHttpClient } from './http';

/*
 * 钉钉客户端（待办 05）：真实现的接口调用（通讯录逐层与分页、错误码翻译、访问凭证缓存、扫码登录换身份、工作通知），
 * Stream 一帧的解析与回执，以及 Fake 的通讯录、事件重推与示例数据回放。
 * 不连外网：undici 的 MockAgent 按 URL 回放录好的返回（写法照钉钉开放平台文档），没登记的请求直接失败。
 */

const OAPI = 'https://oapi.dingtalk.com';
const API = 'https://api.dingtalk.com';
const CREDENTIALS = {
  clientId: 'dingclientid',
  clientSecret: 'client-secret',
  agentId: '3100000001',
  corpId: 'dingcorp',
};

/** 测试里不连 Stream */
const noStream: DingtalkStream = {
  pull: () => Promise.reject(new Error('测试不连 Stream')),
  acknowledge: () => Promise.resolve(),
  close: () => Promise.resolve(),
};

let agent: MockAgent;
let now = 0;
const client = (): DingtalkClient =>
  createRealDingtalkClient(
    createHttpClient('dingtalk', { dispatcher: agent }),
    CREDENTIALS,
    noStream,
    () => now,
  );
const oapi = () => agent.get(OAPI);

/** 换访问凭证（gettoken） */
function token(value = 'token-1', expiresIn = 7200) {
  oapi()
    .intercept({ path: /^\/gettoken\?appkey=dingclientid&appsecret=client-secret$/ })
    .reply(200, { errcode: 0, errmsg: 'ok', access_token: value, expires_in: expiresIn });
}

/** 一次旧版接口调用：路径、访问凭证与请求体都要对上 */
function post(path: string, body: unknown, reply: object, accessToken = 'token-1') {
  oapi()
    .intercept({
      path: `${path}?access_token=${accessToken}`,
      method: 'POST',
      body: JSON.stringify(body),
    })
    .reply(200, reply);
}

beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
  now = Date.UTC(2026, 8, 11, 2, 20);
});

afterEach(async () => {
  agent.assertNoPendingInterceptors();
  await agent.close();
});

describe('通讯录全量读取（每小时对账）', () => {
  it('从根部门逐层取全部门，逐个部门分页取成员，同一人在几个部门只算一次', async () => {
    token();
    post(
      '/topapi/v2/department/get',
      { dept_id: 1 },
      {
        errcode: 0,
        result: { dept_id: 1, name: '集团' },
      },
    );
    post(
      '/topapi/v2/department/listsub',
      { dept_id: 1 },
      {
        errcode: 0,
        result: [{ dept_id: 100, name: 'FSH', parent_id: 1 }],
      },
    );
    post(
      '/topapi/v2/department/listsub',
      { dept_id: 100 },
      {
        errcode: 0,
        result: [{ dept_id: 101, name: '客服部', parent_id: 100 }],
      },
    );
    post('/topapi/v2/department/listsub', { dept_id: 101 }, { errcode: 0, result: [] });
    post(
      '/topapi/v2/user/list',
      { dept_id: 1, cursor: 0, size: 100 },
      {
        errcode: 0,
        result: { has_more: false, list: [] },
      },
    );
    post(
      '/topapi/v2/user/list',
      { dept_id: 100, cursor: 0, size: 100 },
      {
        errcode: 0,
        result: {
          has_more: false,
          list: [
            {
              userid: 'liuyang',
              unionid: 'union-ly',
              name: '刘洋',
              dept_id_list: [100, 101],
              email: 'ly@x.com',
            },
          ],
        },
      },
    );
    post(
      '/topapi/v2/user/list',
      { dept_id: 101, cursor: 0, size: 100 },
      {
        errcode: 0,
        result: {
          has_more: true,
          next_cursor: 1,
          list: [
            { userid: 'liting', name: '李婷', dept_id_list: [101], org_email: 'lt@forcome.com' },
          ],
        },
      },
    );
    post(
      '/topapi/v2/user/list',
      { dept_id: 101, cursor: 1, size: 100 },
      {
        errcode: 0,
        result: {
          has_more: false,
          list: [{ userid: 'liuyang', name: '刘洋', dept_id_list: [100, 101] }],
        },
      },
    );

    const directory = await client().readDirectory();
    expect(directory.departments).toEqual([
      { id: '1', name: '集团', parentId: null },
      { id: '100', name: 'FSH', parentId: '1' },
      { id: '101', name: '客服部', parentId: '100' },
    ]);
    expect(directory.users).toEqual([
      {
        userId: 'liuyang',
        name: '刘洋',
        departmentIds: ['100', '101'],
        email: 'ly@x.com',
        unionId: 'union-ly',
      },
      {
        userId: 'liting',
        name: '李婷',
        departmentIds: ['101'],
        email: 'lt@forcome.com',
        unionId: null,
      },
    ]);
  });

  it('访问凭证缓存到过期前 5 分钟；钉钉说凭证失效时换新的再试一次', async () => {
    const dingtalk = client();
    token('token-1');
    post(
      '/topapi/v2/user/get',
      { userid: 'liting' },
      {
        errcode: 0,
        result: { userid: 'liting', name: '李婷', dept_id_list: [101] },
      },
    );
    post(
      '/topapi/v2/user/get',
      { userid: 'liting' },
      {
        errcode: 0,
        result: { userid: 'liting', name: '李婷', dept_id_list: [101] },
      },
    );
    await dingtalk.getUser('liting');
    await dingtalk.getUser('liting');

    // 过了 1 小时 56 分：提前换新
    now += 116 * 60_000;
    token('token-2');
    post(
      '/topapi/v2/user/get',
      { userid: 'liting' },
      { errcode: 40014, errmsg: 'invalid token' },
      'token-2',
    );
    token('token-3');
    post(
      '/topapi/v2/user/get',
      { userid: 'liting' },
      {
        errcode: 0,
        result: { userid: 'liting', name: '李婷（新）', dept_id_list: [101] },
      },
      'token-3',
    );
    await expect(dingtalk.getUser('liting')).resolves.toMatchObject({ name: '李婷（新）' });
  });

  it('成员或部门不存在时为 null；限流可重试，其他错误码不可重试', async () => {
    const dingtalk = client();
    token();
    post('/topapi/v2/user/get', { userid: 'gone' }, { errcode: 60121, errmsg: '找不到该用户' });
    post('/topapi/v2/department/get', { dept_id: 999 }, { errcode: 60003, errmsg: '部门不存在' });
    post('/topapi/v2/user/get', { userid: 'busy' }, { errcode: 90002, errmsg: '限流' });
    post('/topapi/v2/user/get', { userid: 'bad' }, { errcode: 60011, errmsg: '没有权限' });
    await expect(dingtalk.getUser('gone')).resolves.toBeNull();
    await expect(dingtalk.getDepartment('999')).resolves.toBeNull();
    const throttled = await dingtalk.getUser('busy').catch((e: unknown) => e);
    expect(throttled).toBeInstanceOf(ExternalCallFailedError);
    expect((throttled as ExternalCallFailedError).retryable).toBe(true);
    const denied = await dingtalk.getUser('bad').catch((e: unknown) => e);
    expect((denied as ExternalCallFailedError).retryable).toBe(false);
    expect((denied as Error).message).toContain('errcode 60011');
  });
});

describe('扫码登录：授权码换出扫码人（unionid 与本组织的用户 ID）', () => {
  it('授权码 → 用户凭证 → 个人信息的 unionId → 本组织的用户 ID', async () => {
    agent
      .get(API)
      .intercept({
        path: '/v1.0/oauth2/userAccessToken',
        method: 'POST',
        body: JSON.stringify({
          clientId: 'dingclientid',
          clientSecret: 'client-secret',
          code: 'auth-code',
          grantType: 'authorization_code',
        }),
      })
      .reply(200, { accessToken: 'user-token', expireIn: 7200, corpId: 'dingcorp' });
    agent
      .get(API)
      .intercept({
        path: '/v1.0/contact/users/me',
        headers: { 'x-acs-dingtalk-access-token': 'user-token' },
      })
      .reply(200, { nick: '李婷', unionId: 'union-liting' });
    token();
    post(
      '/topapi/user/getbyunionid',
      { unionid: 'union-liting' },
      {
        errcode: 0,
        result: { contact_type: 0, userid: 'liting' },
      },
    );
    await expect(client().identifyByAuthCode('auth-code')).resolves.toEqual({
      unionId: 'union-liting',
      userId: 'liting',
    });
  });

  it('已离职（或不是本组织的人）：unionid 换不到用户 ID，只给出 unionid（登录按它认出是谁）', async () => {
    agent
      .get(API)
      .intercept({ path: '/v1.0/oauth2/userAccessToken', method: 'POST' })
      .reply(200, { accessToken: 'user-token' });
    agent
      .get(API)
      .intercept({ path: '/v1.0/contact/users/me' })
      .reply(200, { unionId: 'union-gone' });
    token();
    post(
      '/topapi/user/getbyunionid',
      { unionid: 'union-gone' },
      { errcode: 60121, errmsg: '找不到该用户' },
    );
    await expect(client().identifyByAuthCode('code')).resolves.toEqual({
      unionId: 'union-gone',
      userId: null,
    });
  });

  it('授权码无效、过期或已用过（钉钉返回 400）是 DingtalkAuthCodeError；401、403（多半是凭据配错）照常是调用失败', async () => {
    agent
      .get(API)
      .intercept({ path: '/v1.0/oauth2/userAccessToken', method: 'POST' })
      .reply(400, { code: 'InvalidAuthCode', message: '授权码无效' });
    await expect(client().identifyByAuthCode('used')).rejects.toBeInstanceOf(DingtalkAuthCodeError);

    agent
      .get(API)
      .intercept({ path: '/v1.0/oauth2/userAccessToken', method: 'POST' })
      .reply(401, { code: 'InvalidClient', message: 'clientSecret 不对' });
    const error = await client()
      .identifyByAuthCode('code')
      .catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(DingtalkAuthCodeError);
    expect(error).toBeInstanceOf(ExternalCallFailedError);
  });

  it('钉钉服务端出错（5xx）不是授权码的问题，照常是可重试的调用失败', async () => {
    agent
      .get(API)
      .intercept({ path: '/v1.0/oauth2/userAccessToken', method: 'POST' })
      .reply(503, 'busy');
    const error = await client()
      .identifyByAuthCode('code')
      .catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(DingtalkAuthCodeError);
    expect((error as ExternalCallFailedError).retryable).toBe(true);
  });
});

describe('工作通知', () => {
  it('发文本工作通知：AgentId、逗号分隔的用户 ID 与内容', async () => {
    token();
    post(
      '/topapi/message/corpconversation/asyncsend_v2',
      {
        agent_id: 3100000001,
        userid_list: 'liuyang,zhoumin',
        msg: { msgtype: 'text', text: { content: '【Forcome Support】Gmail 连接异常' } },
      },
      { errcode: 0, task_id: 256271667526 },
    );
    await expect(
      client().sendWorkNotification({
        userIds: ['liuyang', 'zhoumin'],
        text: '【Forcome Support】Gmail 连接异常',
      }),
    ).resolves.toEqual({ taskId: '256271667526' });
  });
});

describe('Stream 的一帧', () => {
  it('通讯录事件：类型、事件 ID 与涉及的成员、部门（数字一律转成字符串）', () => {
    const frame = parseStreamFrame(
      JSON.stringify({
        specVersion: '1.0',
        type: 'EVENT',
        headers: {
          messageId: 'm-1',
          eventType: 'user_add_org',
          eventId: 'e-1',
          topic: '*',
          contentType: 'application/json',
        },
        data: JSON.stringify({ timeStamp: 1, userId: ['liting'] }),
      }),
    );
    expect(frame).toEqual({
      kind: 'event',
      event: {
        messageId: 'm-1',
        type: 'user_add_org',
        eventId: 'e-1',
        userIds: ['liting'],
        departmentIds: [],
      },
    });
    const dept = parseStreamFrame(
      JSON.stringify({
        type: 'EVENT',
        headers: { messageId: 'm-2', eventType: 'org_dept_create' },
        data: JSON.stringify({ DeptId: [101] }),
      }),
    );
    expect(dept).toMatchObject({ event: { departmentIds: ['101'], userIds: [] } });
  });

  it('ping 原样回应，disconnect 断开重连，认不出的忽略', () => {
    const ping = {
      type: 'SYSTEM',
      headers: { messageId: 'p-1', topic: 'ping', contentType: 'application/json' },
      data: '{"opaque":"abc"}',
    };
    const reply = parseStreamFrame(JSON.stringify(ping));
    expect(reply.kind).toBe('reply');
    expect(JSON.parse(reply.kind === 'reply' ? reply.text : '')).toEqual({
      code: 200,
      headers: ping.headers,
      message: 'OK',
      data: '{"opaque":"abc"}',
    });
    expect(
      parseStreamFrame(
        JSON.stringify({ type: 'SYSTEM', headers: { messageId: 'd', topic: 'disconnect' } }),
      ),
    ).toEqual({ kind: 'disconnect' });
    expect(parseStreamFrame('not json')).toEqual({ kind: 'ignore' });
    expect(
      parseStreamFrame(JSON.stringify({ type: 'CALLBACK', headers: { messageId: 'c' } })),
    ).toEqual({
      kind: 'ignore',
    });
  });

  it('回执：messageId 与处理成功', () => {
    expect(JSON.parse(ackFrame('m-1'))).toEqual({
      code: 200,
      headers: { contentType: 'application/json', messageId: 'm-1' },
      message: 'OK',
      data: JSON.stringify({ status: 'SUCCESS', message: 'success' }),
    });
  });
});

describe('Fake 钉钉', () => {
  it('改通讯录推对应的事件；拉走没确认的下次重推，确认后不再出现；silent 只改通讯录不推事件', async () => {
    const fake = new FakeDingtalk();
    const dingtalk = fake.client();
    fake.addDepartment({ id: '200', name: '品质部', parentId: '1' });
    fake.addUser({ userId: 'u1', name: '新人', departmentIds: ['200'], email: null });
    fake.updateUser('u1', { name: '新人（改名）' }, { silent: true });

    const first = await dingtalk.pullEvents({ waitSeconds: 0 });
    expect(first.map((e) => [e.type, e.userIds, e.departmentIds])).toEqual([
      ['org_dept_create', [], ['200']],
      ['user_add_org', ['u1'], []],
    ]);
    // 没确认：再拉一次还在
    const again = await dingtalk.pullEvents({ waitSeconds: 0 });
    expect(again.map((e) => e.messageId)).toEqual(first.map((e) => e.messageId));
    await dingtalk.acknowledgeEvents(again.map((e) => e.messageId));
    expect(await dingtalk.pullEvents({ waitSeconds: 0 })).toEqual([]);
    await expect(dingtalk.getUser('u1')).resolves.toMatchObject({ name: '新人（改名）' });

    fake.removeUser('u1');
    expect((await dingtalk.pullEvents({ waitSeconds: 0 }))[0]).toMatchObject({
      type: 'user_leave_org',
      userIds: ['u1'],
    });
    await expect(dingtalk.getUser('u1')).resolves.toBeNull();
  });

  it('授权码一次有效；离职的人扫码只认得出 unionid；发出的工作通知记下来供断言', async () => {
    const fake = new FakeDingtalk();
    const dingtalk = fake.client();
    fake.addUser({ userId: 'liting', name: '李婷', departmentIds: [], email: null });
    const code = fake.issueAuthCode('liting');
    await expect(dingtalk.identifyByAuthCode(code)).resolves.toEqual({
      unionId: 'union-liting',
      userId: 'liting',
    });
    await expect(dingtalk.identifyByAuthCode(code)).rejects.toBeInstanceOf(DingtalkAuthCodeError);
    fake.removeUser('liting');
    await expect(dingtalk.identifyByAuthCode(fake.issueAuthCode('liting'))).resolves.toEqual({
      unionId: 'union-liting',
      userId: null,
    });
    await dingtalk.sendWorkNotification({ userIds: ['liuyang'], text: '你好' });
    expect(fake.sent).toEqual([
      { userIds: ['liuyang'], text: '你好', taskId: expect.any(String) as string },
    ]);
  });

  it('从示例数据回放通讯录：8 位示例成员（用户 ID 是夹具的 key）加两家生产厂的负责人，部门逐级建好', async () => {
    const fixture = getDemoFixture();
    const fake = new FakeDingtalk();
    fake.replay(fixture);
    const directory = await fake.client().readDirectory();
    expect(directory).toEqual(fixtureDirectory(fixture));
    expect(directory.users.map((u) => u.userId)).toEqual([
      ...fixture.members.map((m) => m.key),
      factoryHeadUserId('FQD'),
      factoryHeadUserId('FZJ'),
    ]);
    expect(directory.users.find((u) => u.userId === factoryHeadUserId('FQD'))?.name).toBe('刘厂长');
    const byId = new Map(directory.departments.map((d) => [d.id, d]));
    const path = (id: string): string[] => {
      const department = byId.get(id);
      if (!department || department.parentId === null) return [];
      return [...path(department.parentId), department.name];
    };
    for (const member of fixture.members) {
      const user = directory.users.find((u) => u.userId === member.key);
      expect(path(user?.departmentIds[0] ?? '').join(' / ')).toBe(member.dept);
    }
    // 回放不推事件：这些人本来就在通讯录里，由全量对账同步
    expect(await fake.client().pullEvents({ waitSeconds: 0 })).toEqual([]);
  });
});
