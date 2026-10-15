# DSH 独立开发环境

开发入口为 <http://10.126.126.12:18780/>。生产入口继续使用 <https://dsh.e5box.a2d2.dev/>。两者是独立 DSH 实例，开发页面用于验证 A²D² 插件在途功能。

## 目录和服务

| 用途 | 开发路径或服务 |
| --- | --- |
| Runtime 源码 | `/data/src/github.com/deepseek-ai/deepseek-harness-dev`，独立 git worktree，初始提交 `a45068d2ec03326c800c68c9bdcd47508e3ccb9c` |
| A²D² 插件 | `/data/src/github.com/a2d2-dev/dsh-plugin.worktrees/task-runtime-phase1`，通过 profile 的 `link:` 引入 |
| DSH_HOME | `/data/_dsh-dev`，权限 `0700` |
| Profile | `/data/_dsh-dev/profiles/web` |
| 会话、存储、附件、缓存 | DSH_HOME 下的 `sessions`、`storages`、`attachments`、`cache` |
| 开发项目 | `/data/_dsh-dev/projects/runtime-verification`，独立 git 仓库 |
| 项目任务数据 | 开发项目内的 `.dsh/a2d2` |
| 后台任务运行记录 | `/data/_dsh-dev/a2d2/task-runtime` |
| DSH 服务 | `dsh-dev-web-server`，公开 `dsh web` CLI 启动 profile |
| 入口代理 | `dsh-dev-web-proxy`，仅绑定 `10.126.126.12:18780` |
| 日志 | `/data/_dsh-dev/logs` |

DSH 当前的 CLI 禁止 `--host 0.0.0.0`，webserver 配置也不接受直接绑定 mesh IP。开发后端使用内部端口 18781，独立 TCP 代理负责 mesh 入口与 WebSocket；该内部地址不是验收入口。部署模板在 [deploy](../deploy/)。运行脚本和 supervisor 模板中的路径是本机的固定部署路径。

## 数据与配置隔离

开发实例不共享生产的 sessions、storages、settings、profile、附件或项目任务数据。只分开 DSH_HOME 无法隔离同一项目内的 `.dsh/a2d2`，因此开发验收只使用上表中的独立项目。

模型配置从生产 profile 按条目复制：`llm-pi-ai`、`agent-default-model`、`ui-settings-general`、`a2d2`、`typert-gateway`。解析使用项目的 `yaml` 包，保证 YAML 1.2 下模型 reasoning effort 的 `off` 键仍是字符串。生产 `a2d2.root` 被改为开发项目路径。

开发 profile 的 bundle 列表仅为 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`dsh-a2d2`。`a2d2-github-watch` 显式 disabled；未挂载 Feishu、notifier、远端 OAuth 或生产定时任务 bundle。目录选择器使用 `@deepseek-ai/dsh-host-directory-picker-browse`，可以在远程浏览器选择开发项目。

`.credentials.yaml` 和 `web-password` 是私有独立文件副本，权限 `0600`，没有 symlink 或 hardlink 到生产。开发登录口令初始与生产相同，之后可独立修改 `/data/_dsh-dev/web-password` 并重启开发服务。`service-env.json` 只允许 `DEEPSEEK_API_KEY` 键；启动器拒绝其他键。不要把这些文件、浏览器 cookie 或完整配置 dump 提交到 Git。

这是数据目录和运行进程隔离，服务仍以当前机器的 root 身份运行；不是操作系统级沙箱。开发工作空间与测试命令必须继续限定在开发项目，不能把生产项目添加到开发工作空间。

## 更新插件

```bash
cd /data/src/github.com/a2d2-dev/dsh-plugin.worktrees/dev-environment
./scripts/dev-environment-update.sh
```

脚本检查 profile 的 `link:` 和实际模块链接均指向 `task-runtime-phase1`，通过 flock 阻止重复更新，然后只停止 `dsh-dev-web-server`、构建开发插件、重新启动该服务。宿主插件修改需要重启；客户端 bundle 在该次构建一起更新。脚本不会执行 git pull 或覆盖在途源码，也不会重启生产服务。应在代码处于可构建状态时执行，避免与另一个构建进程同时写 `lib`。

需要更新 runtime 源码时，先在独立 runtime worktree 切换至审核过的提交，再运行 `./scripts/dev-environment-update.sh --runtime`；该选项先构建开发 runtime，再构建插件。构建失败时开发服务保持停止，修复后重跑即可；不会将半成品自动当作成功版本启动。

```bash
supervisorctl status dsh-dev-web-server dsh-dev-web-proxy
supervisorctl restart dsh-dev-web-server
```

停止或重启后后台运行器如何恢复，由对应插件实现决定。部署脚本本身只管理进程，不更改任务状态。

## 初次部署记录与重建

1. 从生产 runtime 已知提交创建新的 git worktree；不在生产 worktree 安装依赖或构建。依赖使用 `pnpm install --offline --frozen-lockfile --ignore-scripts`，避免仓库安装脚本改写共享 git hooks。本机 pnpm store 为 `/data/.pnpm-store/v10`。
2. 初次启动使用生产 runtime 对应的 `packages/*/*/lib`、`vendor/*/lib`、`apps/*/lib`、`apps/web/dist`、`native/system/lib` 与 Linux native `bin` 的独立文件副本；没有链接生产编译目录。该次未重编整个 runtime，页面仍保留源产物的 build 标识。后续完整重建使用上面的 `--runtime` 命令。
3. 创建全新 DSH_HOME 和项目 git 仓库；会话、workspace、storage、附件从空目录开始。只复制上述审核过的配置和凭据。新 profile 的 `packageManager` 为 `pnpm@11.7.0`，与 runtime 一致；设 `autoInstallPeers: false` 和 `nodeLinker: hoisted`。
4. 在开发 runtime 运行 `DSH_HOME=/data/_dsh-dev pnpm dsh plugin --profile web install --ignore-scripts`，通过公开 CLI 安装该 profile。首次基线启动暂时链接部署 worktree；实现验证结束后改为 `task-runtime-phase1` 并再次安装，不能保留基线链接作为最终开发配置。
5. 创建私有 `service-env.json`，设为 `0600`，内容为允许的凭据键映射；可以是空对象。启动器使用独立 `DSH_HOME`、`XDG_CACHE_HOME` 和 `TMPDIR`，并通过 `node --import tsx/esm apps/cli/src/bin.ts web` 启动公开 DSH CLI；这与仓库 `pnpm dsh` 的脚本入口相同，避免 Corepack 向空缓存下载包。
6. TCP 代理使用 Ubuntu 的 socat。部署时系统根分区空间不足，未安装系统包；在开发 cache 中 `apt-get download socat`，通过 `dpkg-deb -x` 解包至 `/data/_dsh-dev/tools/socat`，模板引用其 `usr/bin/socat`。复制两个 `deploy/dsh-dev-*.conf` 到 `/etc/supervisor/conf.d/`，执行 `supervisorctl reread`，然后仅 `supervisorctl update dsh-dev-web-server dsh-dev-web-proxy`。不要执行无范围的 `supervisorctl update/restart all`。

## 验收

目的：确认开发网页可登录，初始会话与工作空间独立，新增开发工作空间只写开发存储，生产进程及数据路径未被替换。

步骤：读取 agent-browser core 技能；从 mesh 入口打开登录页，用私有文件填入口令；通过 Preview Notice；记录无会话、无 workspace 的首页；用页面目录选择器添加独立开发项目；检查浏览器错误、进程 PID、数据文件 inode 与模块链接。

记录：2026-10-15 的基线验证通过。初始 `workspaceIds=[]`，session JSONL 数量为 0；页面添加后只有 `runtime-verification` 工作空间，模型控件显示 `gpt-6.1-sol / Xhigh`，浏览器 errors 为空。生产 `dsh-web-server` 始终为 PID `1339798`，未重启生产 watch。完整的中文报告、截图与脱敏 JSON 存放于本机 `docs/artifacts/task-runtime-dev-2026-10-15/`，由主会话统一发布到 LogSeq；截图和编译产物不提交。

该次基线验证未发送模型请求，也未验证尚在开发中的任务运行器。任务运行器验收以主会话后续独立报告为准。检查时系统根分区可用空间为 0，成因尚未由本部署任务确认；开发目录所在 `/data` 有余量。
