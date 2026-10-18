# A²D² 插件独立修复、合并与开发部署

后续状态：LF 要求统一使用 Codex 后，已用新的 Codex 父会话完成真实派发与自动结算回传。详见 [Codex 验收报告](../codex-dispatch-2026-10-18/REPORT.md)。下文保留此前 DS Flash 余额不足的现场记录。

## 当前结果与范围

插件修复 PR [#117](https://github.com/a2d2-dev/dsh-plugin/pull/117) 已合并到一期分支，开发环境已加载提交 `6c9ccb6f0d5d2caea7275fc798caf36436af4f69`，入口为 <http://10.126.126.12:18780/>。一期 PR #114 与开发部署 PR #113 按 LF 的合并部署指令收尾，目标为原定插件基线分支 `baseline/dsh-production-20261015`。

**此前新增 DSH `selectLocalModel` 的补丁 `e968fabec8` 已从交付范围撤回，未合并、未部署。** 本次只修改插件仓库；未新增会话级选模接口，未修改 DSH 源码、默认模型或沙箱策略，也未升级运行时。原先已存在的普通会话初始化逻辑保持原状，不属于本次派发接口修复。

开发 DSH 保持 `0.2.0-rc.2`、提交 `a45068d2ec03326c800c68c9bdcd47508e3ccb9c`。部署前后 `session-controller/src/index.ts` 和 `commands.ts` 的 SHA256 分别保持 `8ab5d8493477a6addb2d8ebc25f2ed46ec94ce09590ee7af1591732d0aa2507f`、`afe09b990001a29397287ac47c571d784f0dcb7b4810d3bcad4ab7583a968e62`。生产服务 PID 始终为 `931642`，没有执行生产重启或升级。

## 实验目的

不定制 DSH，修复插件在新宿主调用不存在的 `startContinuable`，同时保留现有旧宿主的派发能力；验证 Team UUID 原样保留与路径安全，并尝试从真实页面完成无写入派发和父会话回传。

## 步骤与记录

1. 从一期 PR #114 的实际分支建立独立修复 worktree，未采用此前面向 0.2.1 的整体依赖升级方案。
2. 先增加只有 `startActivation` 的宿主用例，复现 `subagents.startContinuable is not a function`；另一个用例证明旧代码在新接口存在时仍错误地调用旧接口。
3. 插件优先调用 `startActivation` 并传入 `delivery: 'parent'`。只有方法不存在时才调用旧接口；新接口抛错时不重试，避免重复派发。模型与 effort 通过创建请求传入，未调用事后选模接口。
4. 两个版本的请求和方法类型来自已发布的 DSH 包；别名包仅作开发类型依赖。补齐测试所需 peer 依赖，并给插件任务运行器 Config 添加明确类型，修复声明构建的可移植性错误。
5. `pnpm test`：39 个文件、665 项通过。覆盖新接口、旧接口、新接口失败不重试、原有派发字段及 UUID/非法路径输入。`pnpm typecheck`、`pnpm build` 均通过。
6. 合并 #117 后，将现有开发插件 checkout 快进到合并提交，执行锁文件安装，并运行现有 `scripts/dev-environment-update.sh`。只重启 `dsh-dev-web-server`，未使用 `--runtime`。服务以 PID `1423918` 正常运行，原代理 PID `4462` 保持运行。
7. 使用 agent-browser 登录现有开发入口，创建独立验收工作空间与会话，从真实输入框提交要求绑定本地测试任务、派发只读子代理并等待回传的请求。没有用 HTTP 脚本代替页面操作。
8. 父会话第一次模型请求使用实际路由 `deepseek-official / deepseek-flash / high`；页面显示 `Request quota exhausted`，持久日志为 HTTP `402`、`QUOTA`、`Insufficient Balance`。工具清单确实包含 `bind_main_session` 和 `dispatch_subagent`，但实际工具调用数为 **0**，因此未创建子代理。

## 验收限制

部署及自动化验证通过；**真实子代理 provider/model/reasoningEffort 和父会话完成通知仍未验证**。原因是父会话模型余额不足，在派发前即被拒绝。本轮未切换模型、修改默认设置或放宽沙箱以绕过该错误。余额恢复后可在同一会话重试。

本轮未重跑一期完整自动交接与重启恢复验收，也未将此前的 654 项或真实模型链路记录冒认为本次证据。Issue #112 未关闭，Project 状态未修改。

## 证据

- [机器可读记录](https://10.126.126.12:5200/assets/%E5%B7%A5%E4%BD%9C/assets/share_1792337128271_A2D2_%E6%8F%92%E4%BB%B6%E7%8B%AC%E7%AB%8B%E4%BF%AE%E5%A4%8D_evidence.json.json)
- 验收父会话：`session-f9408283-4f76-48e4-9703-7d9da47112a4`。

![开发环境部署后页面](https://10.126.126.12:5200/assets/%E5%B7%A5%E4%BD%9C/assets/share_1792337128265_A2D2_%E6%8F%92%E4%BB%B6%E7%8B%AC%E7%AB%8B%E4%BF%AE%E5%A4%8D_01-deployed.png.png)

![真实父会话因模型额度耗尽失败](https://10.126.126.12:5200/assets/%E5%B7%A5%E4%BD%9C/assets/share_1792337128267_A2D2_%E6%8F%92%E4%BB%B6%E7%8B%AC%E7%AB%8B%E4%BF%AE%E5%A4%8D_02-provider-quota.png.png)
