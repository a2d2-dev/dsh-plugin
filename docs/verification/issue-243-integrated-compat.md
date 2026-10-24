# #243 官方 DSH 插件兼容整合验证

## 目的与范围

将 Session/model 与 jobs 两片适配整合到包含 `3ce39b5` 完成记录碰撞修复的主干，确认无需修改官方宿主源码即可使用其公开接口；保留旧 Host 的回退能力。官方候选为原样源码构建 `22ddee3792402c3e70ec5f86a63c3e3e895a2f60`，CLI `0.2.1-rc.3`，Node24.22.1。此报告不把同版 npm 包视为相同构建，不代表现有3080实例已切换。

整合包含 Session/model `10c4991`、`6187cc5`、`a89799b` 和 jobs `a8fdb4f`、`a340abb`、`d2e4242`。详细合同及单片红灯证据分别见 [Session报告](issue-243-official-session.md) 和 [jobs报告](issue-243-official-jobs.md)。

## 步骤与记录

整合树使用独立本地日志目录；共享开发依赖不安装、不修改。全部 Vitest 运行使用 `--configLoader runner --no-cache`。官方集成设置 `DSH_OFFICIAL_HOST_ROOT` 指向上述构建；jobs fixture 要求 `TMPDIR=$PWD/.local/tmp`，普通 unit/Host fixture 使用没有 `.git` 祖先的独立临时根，避免“无项目标记”场景被父仓库影响。

| 检查 | 实际结果 |
| --- | --- |
| 官方 Session/model 集成 | 4/4 通过，包含模型本地选择、固定身份恢复、preset/权限和已开始会话保护 |
| 官方 jobs 集成 | 1/1 完整场景通过，包含真实 registry、tool/result 时序、冷读取和 V3→V4 journal 迁移 |
| 普通 unit | 93文件、1095项通过 |
| 旧 Host suites | 首次16文件中15文件/134项通过，1项生命周期故障注入超时；修正注入点后该文件2/2通过 |
| 类型检查 | `pnpm typecheck` 通过，包含生命周期注入点修正后的再次检查 |
| 正式构建 | `pnpm build` 通过，包含服务端所有入口/共享分块和浏览器 bundle |
| 仓库不变量 | `pnpm verify:repository` 通过，10个 mount rows |
| 构建导出入口 | `node scripts/assert-pack-entrypoints.mjs` 通过，32个导出目标及sidecars存在 |

原始整合记录仅保存在工作树本地 `.local/tmp/integrated-*.log`，不提交编译产物、凭据或用户会话内容。

初次官方 jobs 运行因父运行参数使用了普通unit的临时根，被fixture的固定路径断言拒绝；随后按jobs合同重跑通过。没有放宽fixture断言。

旧生命周期测试的超时是故障注入仍挂在已不使用的 `SessionController.create`，导致 `reached` 门闩永不释放。改为挂到真实 `resolveAgent` 恢复并flush的边界后，原取消、settlement、禁止晚写和保留/移除fixture断言全部保持并通过，没有增加超时或替换真实Host结果。

## 限制与交付边界

- jobs通过 `settled < direct job_output call < successful result` 的已提交事件证明收取，running开始的wait不能单凭随后terminal result建立该证明，需终态后再次直接读取。缺少原生settled日志的故障没有伪造交付；结果内容理解与业务验收仍是独立责任。
- 明确缺少公开能力的Host会拒绝；`engines.dsh` 的同版允许范围不意味着每种发行构建都有相同API。
- 此处的离线测试和构建不替代最终纯官方profile激活、全量真实数据读取/回退、原GUI登录及旧会话/插件验收。当前服务与数据尚未切换。
