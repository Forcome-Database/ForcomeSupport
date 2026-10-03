# 自建 PostgreSQL 镜像（ADR 0013）：开发测试与生产两套 Compose 共用，镜像名 forcome-postgres。
# 大版本与本机开发库、CI 服务容器一致（18）。WAL-G（每日物理基础备份 + archive_command 连续归档到 NAS）
# 与对应的配置随 28 号待办加进这里，Compose 与部署脚本不用改。
FROM postgres:18
