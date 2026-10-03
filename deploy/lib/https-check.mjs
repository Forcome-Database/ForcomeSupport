// 用导出的根证书核对内网 HTTPS（ADR 0003 修订）：证书链能验到这个根证书、证书域名与 SITE_HOST 相符，
// 再经 HTTPS 取健康检查与首页。只用 Node 自带的 tls/https，不依赖本机的 curl 与系统证书库。
import https from 'node:https';
import tls from 'node:tls';

/**
 * @typedef {object} HttpsTarget
 * @property {string} host 连接的地址（本机测试是 127.0.0.1，模拟内网 DNS 解析）
 * @property {number} port
 * @property {string} servername 内网域名：SNI 与证书域名核对都用它
 * @property {string} ca 根证书（PEM）
 */

/** 握手并验证证书链与域名；失败时抛出 Node 的证书错误（如 UNABLE_TO_VERIFY_LEAF_SIGNATURE、ERR_TLS_CERT_ALTNAME_INVALID） */
export function verifyCertificate(/** @type {HttpsTarget} */ target) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: target.host,
      port: target.port,
      servername: target.servername,
      ca: target.ca,
      rejectUnauthorized: true,
    });
    socket.setTimeout(10_000, () => socket.destroy(new Error('TLS 握手超时')));
    socket.once('secureConnect', () => {
      const leaf = socket.getPeerCertificate();
      socket.end();
      // caddy 内部 CA 签的证书只有 SAN（DNS:域名），没有 CN
      resolve({ names: leaf.subjectaltname, issuer: leaf.issuer?.CN, validTo: leaf.valid_to });
    });
    socket.once('error', reject);
  });
}

/** 经 HTTPS 取一个路径（同样只信任给定的根证书），返回状态码与响应体 */
export function httpsGet(/** @type {HttpsTarget} */ target, path) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      {
        host: target.host,
        port: target.port,
        servername: target.servername,
        ca: target.ca,
        path,
        headers: {
          host: target.port === 443 ? target.servername : `${target.servername}:${target.port}`,
        },
        timeout: 10_000,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => (body += chunk));
        response.on('end', () => resolve({ status: response.statusCode, body }));
      },
    );
    request.on('timeout', () => request.destroy(new Error(`请求 ${path} 超时`)));
    request.on('error', reject);
  });
}
