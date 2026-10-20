# #124 候选部署阶段

CEO 明确开绿 source `876758c8566e50c0db0df53e27ada46b8041c223` 后执行。第一步实测指定 worktree、`test/a2d2-v3-04-acceptance`、干净状态和 HEAD `48658d9fb9267f8ed870d92b7e1337954bddfddc` 均吻合。

[部署工具](./deploy.mjs) 先核验 CEO 唯一 tgz/包内 client SHA，捕获 [安装前新基线](./before-retention.json)，再备份当前 manifest/lockfile/launcher/patch 到 preview 独立版本目录。版本化 tgz 与备份 hash 见 [准备清单](./deployment-prepared.json)；旧 HTTP132 包和历史 rollback 均保留。只更新 `dsh-a2d2` file dependency、对应 lockfile、launcher package SHA 与新增 `GH_CONFIG_DIR=/root/.config/gh`，保留 preview 自有 state/home/workspace/guard/patch。安装 exit 0，installed client hash吻合，见 [安装清单](./deployment-installed.json)。

仅 `supervisorctl restart dsh-a2d2-v3-preview`，RUNNING PID `149203`、child `149210`、run ID `8ff9ecbb-d772-42fc-9480-64f2ef7d6dd1`。服务仍为 `http://10.126.126.12:18782/`，tgz SHA `b7939639179faf84563a9d486ef768600e642e0722db22a1fb84fe9444c9bf5b`，client SHA `93baf01e6222cefc5710403f0c29e59ae9258d31fd3ca930b1c1e3a1a7476f61`。

首个 `curl --fail` 返回 HTTP401/exit22，随后只读诊断确认返回登录 password markup 的正常认证边界，见 [HTTP健康证据](./http-health.json)，未启动替代服务或改变认证配置。[重启后保留](./after-restart-retention.json) exit0：旧2Project/2Agent/3Task/9receipt逐row hash相同；Session两文件及417 bytes整文件hash相同；addedSessionFiles为空；guard/patch相同；gateway/adapter=0。旧JSON缺source字段的首次加载没有使既有持久数据变化。认证后产品浏览器验收此时尚未执行。
