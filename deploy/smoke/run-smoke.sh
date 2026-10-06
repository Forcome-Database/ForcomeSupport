#!/bin/sh
# 冒烟容器的入口（ADR 0013 修订）：先让 Chromium 信任 caddy 的根证书，再对 E2E_BASE_URL 跑 Playwright。
# 根证书从 caddy 的数据卷只读挂进来（/caddy-data）；Chromium 在 Linux 上读 ~/.pki/nssdb，
# 证书只加进这个一次性容器，浏览器按正常规则校验证书链与域名（不忽略证书错误）。
# caddy 写的证书文件只有 root 可读，所以容器以 root 运行；Playwright 默认关闭 Chromium 沙箱，不受影响。
set -eu

ROOT_CERT=/caddy-data/caddy/pki/authorities/local/root.crt
NSSDB="sql:$HOME/.pki/nssdb"

mkdir -p "$HOME/.pki/nssdb" /report
certutil -d "$NSSDB" -N --empty-password
certutil -d "$NSSDB" -A -t "C,," -n "Forcome Support Internal Root CA" -i "$ROOT_CERT"
# Node 一侧（route.fetch 取真实响应再改写、APIRequestContext）不读 NSS 库，同一张根证书另经 NODE_EXTRA_CA_CERTS 交给 Node（待办 06）
export NODE_EXTRA_CA_CERTS="$ROOT_CERT"

# 报告写到 /report，部署脚本跑完后用 docker cp 取出（不挂宿主机目录，免得文件属主变成 root）
export PLAYWRIGHT_HTML_OUTPUT_DIR=/report/html
export PLAYWRIGHT_HTML_OPEN=never
export PLAYWRIGHT_JSON_OUTPUT_FILE=/report/results.json
exec ./node_modules/.bin/playwright test --reporter=list,html,json --output=/report/test-results "$@"
