/**
 * 进程内的 HTTP 客户端（主接缝）：直接调用 Hono 应用的 app.request，不起端口；
 * 像浏览器一样保存响应里的 Cookie 并在之后的请求里带上，于是登录一次就是一个会话。
 */
export interface ApiClient {
  request(path: string, init?: RequestInit): Promise<Response>;
  get(path: string): Promise<Response>;
  post(path: string, body?: unknown): Promise<Response>;
  put(path: string, body?: unknown): Promise<Response>;
  patch(path: string, body?: unknown): Promise<Response>;
  delete(path: string): Promise<Response>;
}

/** 能处理请求的应用（Hono 的 app.request） */
export interface RequestHandler {
  request(input: string, init?: RequestInit): Response | Promise<Response>;
}

export interface ApiClientOptions {
  /** 来源 IP：经 X-Forwarded-For 传给应用，与生产经 caddy 转发时一致（ADR 0010 修订） */
  readonly ip: string;
}

function updateJar(jar: Map<string, string>, response: Response): void {
  for (const header of response.headers.getSetCookie()) {
    const [pair = '', ...attributes] = header.split(';').map((part) => part.trim());
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    const expired = attributes.some((a) => {
      const [key = '', raw = ''] = a.split('=');
      if (key.toLowerCase() === 'max-age') return Number(raw) <= 0;
      if (key.toLowerCase() === 'expires') return new Date(raw).getTime() <= Date.now();
      return false;
    });
    if (expired || value === '') {
      jar.delete(name);
    } else {
      jar.set(name, value);
    }
  }
}

export function createApiClient(app: RequestHandler, options: ApiClientOptions): ApiClient {
  const jar = new Map<string, string>();

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (!headers.has('x-forwarded-for')) headers.set('x-forwarded-for', options.ip);
    // 调用方显式给了 Cookie（例如伪造的会话）时以它为准
    if (!headers.has('cookie') && jar.size > 0) {
      headers.set('cookie', [...jar].map(([name, value]) => `${name}=${value}`).join('; '));
    }
    const response = await app.request(path, { ...init, headers });
    updateJar(jar, response);
    return response;
  }

  function withBody(method: string) {
    return (path: string, body?: unknown) =>
      request(path, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
  }

  return {
    request,
    get: (path) => request(path),
    post: withBody('POST'),
    put: withBody('PUT'),
    patch: withBody('PATCH'),
    delete: (path) => request(path, { method: 'DELETE' }),
  };
}
