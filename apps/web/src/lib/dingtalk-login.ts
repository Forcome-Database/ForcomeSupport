import type { DingtalkLoginStart } from '@forcome/contracts';

/*
 * 钉钉扫码登录的二维码（G11，待办 05）：
 * - 真实接口：嵌钉钉官方的扫码登录框（ddlogin.js 的 DTFrameLogin，在页面里放一个钉钉的 iframe 画二维码）。扫码并在手机上确认后，
 *   它交回 redirectUrl（= 服务端给的 redirectUri 带上 authCode 与 state），我们把浏览器带过去，由回调页换会话；
 * - Fake（本机、测试与开发测试环境）：画示意二维码（原型 qr_svg()），扫码由开发工具模拟（/api/dev/dingtalk/scan）。
 * ddlogin.js 只能从钉钉的 CDN 加载（员工浏览器要能访问 g.alicdn.com 与 login.dingtalk.com，docs/部署说明.md「钉钉」）。
 */

/** 钉钉扫码登录框的脚本（钉钉开放平台「网页方式登录应用」文档给的地址） */
export const DINGTALK_LOGIN_SCRIPT =
  'https://g.alicdn.com/dingding/h5-dingtalk-login/0.21.0/ddlogin.js';

/** 扫码登录框的授权参数（文档的写法：redirect_uri 要先编码） */
export interface DingtalkFrameParams {
  readonly redirect_uri: string;
  readonly client_id: string;
  readonly scope: string;
  readonly response_type: 'code';
  readonly state: string;
  readonly prompt: 'consent';
}

export interface DingtalkFrameResult {
  readonly redirectUrl: string;
  readonly authCode: string;
  readonly state?: string;
}

type DtFrameLogin = (
  frame: { readonly id: string; readonly width?: number; readonly height?: number },
  params: DingtalkFrameParams,
  onSuccess: (result: DingtalkFrameResult) => void,
  onError: (message: string) => void,
) => void;

declare global {
  interface Window {
    DTFrameLogin?: DtFrameLogin;
  }
}

/**
 * 扫码登录框的授权参数：Client ID、钉钉带回的地址（钉钉开放平台「重定向 URL」要填同一个）、这次的 state；
 * scope 带 corpid，钉钉返回扫码人所在的组织，服务端再核对一次是本组织
 */
export function dingtalkFrameParams(start: DingtalkLoginStart): DingtalkFrameParams {
  if (!start.clientId) throw new Error('真实接口的扫码登录要有 Client ID');
  return {
    redirect_uri: encodeURIComponent(start.redirectUri),
    client_id: start.clientId,
    scope: 'openid corpid',
    response_type: 'code',
    state: start.state,
    prompt: 'consent',
  };
}

let loading: Promise<DtFrameLogin> | null = null;

/** 加载钉钉的扫码登录框脚本（一个页面只加载一次；失败后下次再试） */
export function loadDingtalkFrame(): Promise<DtFrameLogin> {
  if (window.DTFrameLogin) return Promise.resolve(window.DTFrameLogin);
  loading ??= new Promise<DtFrameLogin>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = DINGTALK_LOGIN_SCRIPT;
    script.async = true;
    script.onload = () => {
      if (window.DTFrameLogin) resolve(window.DTFrameLogin);
      else reject(new Error('钉钉扫码登录框没有加载成功'));
    };
    script.onerror = () => reject(new Error('连不上钉钉，扫码登录框没有加载成功'));
    document.head.append(script);
  }).catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

/**
 * 示意二维码的模块（原型 qr_svg()：25 × 25，三个定位角 + 固定种子的伪随机模块，约 46% 涂黑）：
 * 只在 Fake 时画，不能扫。返回涂黑的格子（x, y），定位角另画
 */
export function demoQrModules(size = 25, seed = 11): { x: number; y: number }[] {
  // mulberry32：固定种子，结果稳定
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const finders = demoQrFinders(size);
  const modules: { x: number; y: number }[] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nearFinder = finders.some(
        (f) => x >= f.x - 1 && x <= f.x + 7 && y >= f.y - 1 && y <= f.y + 7,
      );
      if (nearFinder) continue;
      if (random() < 0.46) modules.push({ x, y });
    }
  }
  return modules;
}

/** 三个定位角的左上角（左上、右上、左下） */
export function demoQrFinders(size = 25): { x: number; y: number }[] {
  return [
    { x: 0, y: 0 },
    { x: size - 7, y: 0 },
    { x: 0, y: size - 7 },
  ];
}
