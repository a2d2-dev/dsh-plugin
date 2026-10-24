# #225 当前会话导航修复验证

## 目的与实现

修复父 #223 中接续后真实当前会话被误拒绝的导航。根因是显式查看入口 `WorkPanelController.openCurrentTask` 把执行状态白名单当作查看资格。最终实现仅调整该方法的两行条件：移除 ready/running/waiting/paused 限制，明确校验非空 sessionId/runtimeId；同 TaskRef、actual/runtime 一致性、最新 `task.detail` 读取、取消和迟到成功响应围栏保持。

打开会话不发送 command，不恢复执行，不改变原任务、owner 或 epoch，不选择 retired 替代当前。启动流程的 `currentSession()` 自动进入规则保持原行为。

## Git 与范围

- 工作树：`/data/src/github.com/a2d2-dev/dsh-plugin/.scratch/current-session-navigation`
- 分支：`fix/223-current-session-navigation`
- 固定开发 base：`f78404dd312b80c4a06f75a41ed9a5e54fbc84c8`。
- 红测提交：`f704337`；首次最小修复：`073411c`；缺会话身份红测：`23da13e`；最终实现及测试：`542b8b5`。最终交付 HEAD 以 Git/PR 回读为准，后续提交只记录证据。
- 交付前 `git ls-remote` 观察到 release/v0.0.22 已推进至 `22f33cc77fa8a85141d9a7c877dadd1c37f2e038`，main 为 `dc944315c3d4a4d21e32b4f81fbb5d6521b2d141`。本分支保留指定 base，没有换成旧 main 或重写已有接续修复。
- 未操作浏览器、其他 checkout/profile、宿主或真实工作库。父会话同时生成的 GUI 记录与截图未由本会话修改或纳入提交。未提交编译产物。

## 验证步骤与记录

所有命令独立执行并保留真实退出码；原始长输出保存在本工作树忽略目录 `.local/issue-223/`。

| 步骤/命令 | 结果 | 原始输出 |
| --- | --- | --- |
| `corepack pnpm install --offline --frozen-lockfile --ignore-scripts` | exit 0；首次 vitest 缺依赖 exit 254 不算红测 | `install.log` |
| `TMPDIR="$PWD/.local/tmp" corepack pnpm exec vitest run tests/client/session-handoff-entry.spec.ts`，修复前 | exit 1；1 failed / 4 passed（5） | `red.log` |
| 同命令，移除错误状态门禁后 | exit 0；5 passed | `green-initial.log` |
| 同命令，加入缺会话/空身份边界测试后 | exit 1；3 failed / 5 passed（8） | `red-session-identity.log` |
| 同命令，补会话身份 guard 后 | exit 0；8 passed | `green-session-identity.log` |
| 同命令，扩展边界覆盖后 | exit 0；22 passed | `green-expanded.log` |
| 扩大到下列 7 套测试 | exit 1；67 passed / 6 failed（73） | `regression.log` |
| 基线控制器对照下列 3 套失败文件 | exit 1；13 passed / 6 failed（19），失败名称 6/6 一致 | `baseline-comparison.log` |
| 最终 4 套导航相关测试 | exit 0；54 passed（4 files） | `final-navigation.log` |
| `corepack pnpm typecheck` | exit 0；server/client 两配置通过 | `typecheck.log` |
| `corepack pnpm build` | exit 0；TS 与 server/client bundle 成功 | `build.log` |
| `git diff --check` | exit 0；无输出 | 命令回执 |

最终通过的命令：

```sh
TMPDIR="$PWD/.local/tmp" corepack pnpm exec vitest run tests/client/session-handoff-entry.spec.ts tests/client/work-panel.spec.ts tests/client/work-startup.spec.ts tests/client/work-observation.spec.ts
```

```text
Test Files  4 passed (4)
Tests       54 passed (54)
[exit code: 0]
```

22 项目标测试包含：最新权威 detail、failed 接续当前 session（明确区分 retired）、完成与用户取消后的查看、错误 Task/项目/执行 ref、runtime 失配、缺 actual/会话/执行、空 sessionId/runtime、挂载取消、预先取消、后续点击替代、面板及来源导航丢弃迟到成功响应、runtime 读取错误向入口抛出，以及导航与轮询均零 command。

## 基线既有失败

扩大命令在最终通过的四套之外加入：

```text
tests/client/work-history.spec.ts
tests/client/work-completed-status.spec.ts
tests/client/work-github-first.spec.ts
```

三套共 19 项中以下 6 项失败。临时将控制器恢复为 f78404dd 的原始内容，以 `git diff --exit-code f78404dd312b80c4a06f75a41ed9a5e54fbc84c8 -- src/client/work-panel-controller.ts tests/client/work-history.spec.ts tests/client/work-completed-status.spec.ts tests/client/work-github-first.spec.ts` 验证相同，再执行同三套得到完全相同的 6 个失败名称；恢复修复后以 `git diff --exit-code HEAD -- src/client/work-panel-controller.ts` 验证恢复精确。没有换 checkout、修改测试、skip 或调整 timeout。

- work-history：`reads Task-scoped pages, uses the returned cursor and escapes transcript markup without native navigation`（缺“查看记录”）；`retains the prior page on failure and retries the same cursor once`（缺“重试读取”）。
- work-completed-status：`shows completion closeout instead of human waiting and hides execution controls until the specification changes`（缺“查看记录”）；`uses the same closeout mapping in Project and Issue rows while remote closed alone remains separate`（缺“正在收口”）。
- work-github-first：`selects a GitHub Project by default and excludes internal records and local entrances from the surface`（缺“Roadmap”）；`shows only GitHub onboarding when all existing records have no GitHub Project`（缺“连接并查看 Issues”）。

这些是固定基线已有的静态 UI 断言失败，未在本票范围内处理。未声称全量测试通过。

## 未验证与父会话交接

真实 GUI 点击、部署与 agent-browser 截图由父 #223 主会话负责，本会话未验证。原生两个入口已有 catch 与 role=alert；没有证据把先前浏览器/CDP 等待超时归为同根因，本补丁不处理该独立疑点。未执行全仓完整测试。PR 目标 release/v0.0.22，禁止合并。
