# #243 官方 DSH Session / Model 兼容验证

## 范围与合同

插件基线为 `acaaece04a6a1494e5c6633c1b9c7d2a2ec35149`，工作分支 `fix/243-official-session`。目标是未经修改的官方 `0.2.1-rc.3`，源码 HEAD `22ddee3792402c3e70ec5f86a63c3e3e895a2f60`。官方源码、profile、live 数据和旧运行 Host 均未修改；没有真实模型调用。测试只在本工作树 `.local/tmp` 内创建独立存储，使用本地确定性 LLM adapter。

- 官方 `Agent.model.current/select` 是公开的会话本地选择。调用方先检查 provider/model catalog、显式 effort 和 `llm.resolveCallConfig`，再在 maintenance 内记录选择；不调用会保存全局默认的 `SessionController.selectModel`。已验证旧 Host 的正式 `selectLocalModel` 仅作为旧 API 兼容分支，官方路径不需要它。已开始且尚未登记插件角色的 Session 拒绝初始化模型。
- `SessionController.create({ sessionId })` 是可复用 blank Session 的创建请求，不是指定 id 的幂等恢复 API。execution startup 使用公开 `sessions.prepare` / `sessionPersistence.create` 保存预留 id 和 `model/selection`，随后调用 `sessionController.resolveAgent`、检查 error 与返回 identity，再调用 `workspace.attachSession`。
- RootSession 首次创建仍用公开 `SessionController.create`，由 Host 在 Agent publication 前装配 preset；丢回执或冷恢复时，已有 id 只走 `resolveAgent`。源码已核对 `AgentRegistry.CreateAgentOptions.meta.agentPreset` / `setup`，没有引入私有 `ApiSessionAgentController` 或自行伪造 preset composition。
- RootSession 校验来源与目标 workspace/cwd；在空白 Session 的 maintenance 内继承源权限。已开始的 Session 不重写权限或模型；旧初始权限与来源不同时阻止接续并要求预留新后继，用户显式变更的既有权限记录予以保留。
- 官方 rc.3 没有旧 `SessionController.inspect`。startup 检查改用公开 `sessionQuery.observeSession` 的 header、events 和 projections。对 `request/header` 比较 adapter 归一化后的 effort，对独立 `model/selection` 保留完整选择的省略语义。
- 不再用插件自己的 `createRequire` 解析 peer 包版本冒充运行 Host 版本。正式启动预检由 `package.json` / `dsh.plugin.json` 的 `engines.dsh` 精确列出 `0.2.0-rc.2 || 0.2.1-rc.2 || 0.2.1-rc.3`，执行侧检查实际服务方法和返回结果。peer 声明增加 rc.3，dev 依赖及 lockfile 保持原状；没有安装依赖或增加 rc.3 alias，也没有 `allow-version`。

公开合同源码：官方 `packages/core/agent/src/runtime-types.ts`（`Model`）、`packages/core/agent/src/index.ts`（create/resume setup）、`packages/api/session-controller/src/agent.ts`（resume composition / blank reuse）、`packages/api/session-controller/src/commands.ts`（默认保存行为）、`packages/boot/app-boot/src/plugin-compatibility.ts`（预检）。

## 实验步骤

所有命令在锁定工作树执行，先设置：

```bash
export PATH=/root/.nvm/versions/node/v24.22.1/bin:$PATH
export TMPDIR="$PWD/.local/tmp"
export DSH_OFFICIAL_HOST_ROOT=/data/src/github.com/deepseek-ai/deepseek-harness-dev.worktrees/dsh-upgrade-latest-20261024
```

官方集成必须显式执行，不使用 skip 或软断言：

```bash
pnpm exec vitest run --config tests/official-session.config.ts --configLoader runner --no-cache
```

配置从 built 官方 packages/vendor 的实际 manifest 解析公开包入口，防止混入插件自己的旧 peer；缺少环境变量、版本不对或缺少 build 时直接失败。真实挂载官方 Agent、SessionController、JSONL apply 插件、preset/permission、access control、native tool executor 和持久化；仅隔离 transport/附件 I/O，并对真实公开方法注入故障。生产插件不导入 Host 内部文件。

## 记录

先红后绿证据保存在未提交的 `.local/tmp`，不提交日志、lib 或 docs/artifacts：

| 校验 | 结果与证据 |
| --- | --- |
| 官方模型选择红灯 | 旧实现报缺少 `selectLocalModel`，修复后模型/effort 测试通过 |
| 精确 identity 红灯 | Root 丢回执重试重复 `create`；execution ensure 两次调用 `create`，修复后都不再通过 blank reuse 恢复 |
| 非 blank 模型保护红灯 | `.local/tmp/started-model-red.log`：旧行为没有拒绝已开始 Session |
| 官方默认 effort 红灯 | `.local/tmp/normalized-effort-red.log`：真实 header 中 adapter 默认 `high` 被错误视为重配置，修复后保留归一化语义 |
| 官方真实集成 | exit 0，4 passed，见 `.local/tmp/official-session-final.log`：启动预检无 exemption、真实 Agent 本地持久选择/校验/全局默认不变、非默认父 preset 在 publication 前装配、严格源权限继承、非 blank 用户会话不变、adapter 默认 effort 的重试语义、resolve error/丢回执/冷恢复固定 id |
| 普通 unit 全跑 | `pnpm exec vitest run --project unit --configLoader runner --no-cache`：exit 1，92 files，1072 passed / 2 failed，见 `.local/tmp/unit.log` |
| 相关 Host 接续回归 | `tests/work-execution.spec.ts` + `tests/work-continuation.spec.ts`：exit 0，42 passed，见 `.local/tmp/startup-recovery-final.log`；park / receipt-loss 注入改到实际 `resolveAgent`，保留原有并发 deadline |
| Root task-runtime 回归 | `tests/task-runtime.spec.ts`：33 passed，见 `.local/tmp/host-regression.log`；该次合跑另有 3 项旧 create checkpoint 测试失败，已改到实际 restore checkpoint 并按上一行重跑通过 |
| 最终相关回归 | exit 0，5 files / 57 passed，见 `.local/tmp/final-regression.log`，包含 model、Root、execution startup、production host 和 panel startup |
| 类型与构建 | `pnpm typecheck`、`pnpm build` 均 exit 0，见 `.local/tmp/typecheck-final.log`、`.local/tmp/build.log`；构建只清理已核对的本工作树 `lib` |

普通 unit 的两个失败都在未改的 `tests/a2d2.spec.ts`：“markerless cwd”和“file marker”。因为本任务要求 TMPDIR 位于工作树内，其祖先存在主仓 `.git` 目录，既有 `resolveProjectRoot` 会正确走到主仓，和这些测试“整个祖先链无 marker”的假设不同。`git diff --exit-code acaaece04a6a1494e5c6633c1b9c7d2a2ec35149 -- src/store.ts tests/a2d2.spec.ts` 返回 0，确认相关实现与测试均为基线内容；没有改变 TMPDIR、跳过测试或放宽断言。

## 尚未覆盖

这里验证 Session/model adapter 及官方公开启动预检，不代表 jobs adapter、完整插件合并后 profile 激活或 GUI 的最终验收。未对 live Host/profile 做任何安装、切换或操作；这些由父任务合并独立 jobs 改动后验证。旧 Host 兼容保留的是既有已验证能力，不能把相同版本号当成所有发行构建都拥有 `selectLocalModel` 的证据；缺少相应公开能力会明确拒绝。
