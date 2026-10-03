// 部署环境（ADR 0013 修订）：每个环境一个固定的 Compose 项目名，部署脚本只操作这里列出的项目。
// 生产环境随 28 号待办加入（打标签 + 人工批准、迁移前自动备份；不灌示例数据、不开开发登录）。

/**
 * @typedef {object} DeployEnvironment
 * @property {string} name 环境名，也是命令行参数与环境文件的后缀（deploy/.env.<name>）
 * @property {string} project Compose 项目名：容器、卷、网络都以它为前缀，两套环境互不影响
 * @property {'staging' | 'production'} appEnv 环境文件里 APP_ENV 必须等于它
 * @property {boolean} seed 部署时灌示例数据夹具（只用于非生产环境）
 * @property {boolean} smoke 部署后跑 Playwright 冒烟（开发登录 → 顶栏，需要开发登录）
 */

/** @type {Readonly<Record<string, DeployEnvironment>>} */
export const ENVIRONMENTS = Object.freeze({
  staging: Object.freeze({
    name: 'staging',
    project: 'forcome-staging',
    appEnv: 'staging',
    seed: true,
    smoke: true,
  }),
});
