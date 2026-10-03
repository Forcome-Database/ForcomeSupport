import type { DemoFixture } from '@forcome/fixtures';
import type { AppEnv } from './config';
import { transaction, type Runtime, type Tx } from './runtime';

/*
 * 示例数据加载器（待办 02）：把示例数据夹具（@forcome/fixtures，原型 data.py 转成的 JSON）灌进数据库，
 * 供本机与开发测试环境的种子数据（pnpm db:seed）、Playwright 与集成测试共用。
 * 加载器只是框架：各模块建表后在自己的待办里定义加载步骤（defineFixtureStep），
 * 从模块的 index.ts 导出，并登记到 apps/server/src/fixtures.ts（工单在 08、台账在 19）。
 */

export interface FixtureStep {
  /** `模块.内容`，如 channel.stores、ticket.tickets、aftersales.ledger */
  readonly name: string;
  /** 先于本步骤执行的步骤（例如台账依赖店铺与成员） */
  readonly after?: readonly string[];
  /**
   * 在加载事务里写入本模块的数据。要幂等：按夹具里的确定性 id 或业务编号写入、已存在则跳过，
   * 重复运行不产生重复数据。只能写本模块的表（ADR 0005），需要别的模块的数据经它的 index.ts。
   */
  load(tx: Tx, fixture: DemoFixture): Promise<void>;
}

const STEP_NAME = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export function defineFixtureStep(step: FixtureStep): FixtureStep {
  if (!STEP_NAME.test(step.name)) {
    throw new Error(`加载步骤名必须是「模块.内容」形式的小写 snake_case：${step.name}`);
  }
  return step;
}

export interface FixtureLoadReport {
  /** 按执行顺序列出的步骤名 */
  readonly steps: readonly string[];
}

export interface LoadFixturesOptions {
  readonly appEnv: AppEnv;
  readonly fixture: DemoFixture;
  readonly steps: readonly FixtureStep[];
}

/** 按依赖排序（同层保持登记顺序）；依赖缺失、循环、重名都报错 */
function ordered(steps: readonly FixtureStep[]): FixtureStep[] {
  const byName = new Map<string, FixtureStep>();
  for (const step of steps) {
    if (byName.has(step.name)) {
      throw new Error(`加载步骤重复登记：${step.name}`);
    }
    byName.set(step.name, step);
  }
  for (const step of steps) {
    for (const dependency of step.after ?? []) {
      if (!byName.has(dependency)) {
        throw new Error(`加载步骤 ${step.name} 依赖的 ${dependency} 没有登记`);
      }
    }
  }
  const done = new Set<string>();
  const result: FixtureStep[] = [];
  while (result.length < steps.length) {
    const ready = steps.filter(
      (s) => !done.has(s.name) && (s.after ?? []).every((d) => done.has(d)),
    );
    if (ready.length === 0) {
      const stuck = steps.filter((s) => !done.has(s.name)).map((s) => s.name);
      throw new Error(`加载步骤之间有循环依赖：${stuck.join('、')}`);
    }
    for (const step of ready) {
      done.add(step.name);
      result.push(step);
    }
  }
  return result;
}

/**
 * 按依赖顺序执行加载步骤，全部在一个事务里：任一步失败则全部回滚。
 * 生产环境拒绝（示例数据只用于本机、开发测试环境与测试）；没有登记任何步骤时什么也不做。
 */
export async function loadFixtures(
  runtime: Runtime,
  options: LoadFixturesOptions,
): Promise<FixtureLoadReport> {
  if (options.appEnv === 'production') {
    throw new Error('生产环境不能加载示例数据');
  }
  const steps = ordered(options.steps);
  await transaction(runtime, async (tx) => {
    for (const step of steps) {
      try {
        await step.load(tx, options.fixture);
      } catch (error) {
        throw new Error(`加载步骤 ${step.name} 失败：${(error as Error).message}`, {
          cause: error,
        });
      }
    }
  });
  return { steps: steps.map((s) => s.name) };
}
