# 自建 PostgreSQL 镜像（ADR 0013 及其修订）：开发测试与生产两套 Compose 共用，镜像名 forcome-postgres。
# 大版本与本机开发库、CI 服务容器一致（18）。待办 28 起内置备份与恢复（docs/运维手册.md）：
# - WAL-G：archive_command 连续归档 WAL（archive_timeout 5 分钟），每日物理基础备份，按时间点恢复；
# - restic：每日 pg_dump 逻辑备份与卷（caddy 的根证书等）加密、去重地存进备份目录，保留 30 份日备份与 12 份月备份；
# - supercronic：备份服务（compose 的 backup）按 BACKUP_CRON 每天跑一次。
# 同一个镜像起三种容器：postgres（数据库本身）、backup（定时备份）、restore / restore-drill（一次性恢复与恢复演练）。
FROM postgres:18

# 版本固定、下载后核对校验和（升级时连同校验和一起改：WAL-G 的发布页给 .sha256，supercronic 的发布说明给 SHA1SUM）。
# WAL-G 用 Ubuntu 22.04 的构建（glibc 2.35），Debian 13 的 glibc 更新，向下兼容
ARG WALG_VERSION=v3.0.9
ARG WALG_SHA256=d6795c663894d836ba20840bffe8970aed81bbe25d3151bd4951f6f9c362def9
ARG SUPERCRONIC_VERSION=v0.2.49
ARG SUPERCRONIC_SHA1=e63c11a9726b775a6a11801e81af4f3fb926aa68

# restic 与 jq 用 Debian 的包；curl 只为下载 WAL-G 与 supercronic
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl jq restic \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL -o /usr/local/bin/wal-g \
      "https://github.com/wal-g/wal-g/releases/download/${WALG_VERSION}/wal-g-pg-22.04-amd64" \
 && echo "${WALG_SHA256}  /usr/local/bin/wal-g" | sha256sum -c - \
 && curl -fsSL -o /usr/local/bin/supercronic \
      "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-amd64" \
 && echo "${SUPERCRONIC_SHA1}  /usr/local/bin/supercronic" | sha1sum -c - \
 && chmod +x /usr/local/bin/wal-g /usr/local/bin/supercronic \
 && wal-g --version && restic version

COPY deploy/postgres/bin/ /usr/local/bin/
# 备份目录：生产挂 NAS（BACKUP_DIR），没设时是 Compose 的命名卷；命名卷第一次挂载时沿用这里的属主（postgres）
RUN chmod +x /usr/local/bin/forcome-* \
 && mkdir -p /backup && chown postgres:postgres /backup

# 连续归档：每个 WAL 段写满或满 5 分钟（有写入时）就经 WAL-G 推到备份目录；自检以 archive_timeout 的 2 倍为「没归档」的阈值
CMD ["postgres", "-c", "archive_mode=on", "-c", "archive_command=/usr/local/bin/forcome-wal-push %p", "-c", "archive_timeout=300"]
