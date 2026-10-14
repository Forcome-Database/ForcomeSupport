// 旧版本镜像的清理（待办 28；部署说明第 9 节原写「自动清理随 28 号待办」）：每次部署按提交号多出一套 forcome-server、
// forcome-web、forcome-smoke（与演练用的 forcome-robot-sink）镜像。部署成功后只留本次与上一次部署的版本（回退用），
// 其余删掉。只看本项目构建的镜像（Compose 给镜像打的 com.docker.compose.project 标签），数据库镜像 forcome-postgres:18 不动；
// 还有容器在用的镜像 Docker 拒绝删除，跳过即可。

/** 按版本打标签的镜像 */
export const RELEASE_REPOSITORIES = [
  'forcome-server',
  'forcome-web',
  'forcome-smoke',
  'forcome-robot-sink',
];

/**
 * 要删的镜像（repo:tag）
 * @param {string[]} listed `docker image ls --format '{{.Repository}}:{{.Tag}}'` 的各行（本项目的）
 * @param {readonly (string | null)[]} keep 要留的版本（本次与上一次）
 */
export function staleImages(listed, keep) {
  const kept = new Set(keep.filter(Boolean));
  return listed
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((ref) => {
      const at = ref.lastIndexOf(':');
      const repository = ref.slice(0, at);
      const tag = ref.slice(at + 1);
      return RELEASE_REPOSITORIES.includes(repository) && tag !== '<none>' && !kept.has(tag);
    })
    .sort();
}
