# #138：人工修改权限后恢复与接续失败

## 目的与实际故障

用户在当前处理会话中把权限从 `workspace-write` 改成 Full access，随后 Task 恢复失败，固定接续操作停留在 `reserved`。公开 `task.execution` 返回：

```text
state: failed
error.code: incompatible-session
error.message: Existing Session permission differs; silent reconfiguration refused
```

本轮使用现有 GUI 和公开查询断言实际复现该错误，没有要求用户改回权限、重建 Task 或创建第二个后继。source 仍是 `session-4c0d3e10…`、epoch 1；接续操作 `e55b31d6-3317-4845-9d27-2fbdabb26da7` 和固定后继 `session-7f523df6-365f-4904-96bc-e4a85fd63583` 保留。

基线为 `origin/main 9c2b91e`，修复在独立分支 `fix/138-permission-recovery`，未改其他工作树。复核排除了把 `status: completed` 当成 Task 完成的旧误读；本次失败有明确运行错误，不能以继续等待代替恢复。

## 根因与修复边界

已归属 Task 的 Session 可以通过宿主原生控件改变有效权限，但 `DshWorkExecutionHost.ensure` 仍将实际权限与启动时的 `execution.permissionPreset` 比较，直接拒绝恢复。已有模型切换恢复采用了当前模型，权限恢复没有采用相同的当前配置语义。

恢复现在沿用宿主当前有效的、可重建的命名权限，返回实际 sandbox／approval，由 WorkApplication 一并更新执行的 `permissionPreset` 和 `actual`。恢复不调用 setter 修改已经开始的来源会话，不改变全局默认权限，不改变 Task／Execution／Session／owner／epoch，也不替换固定后继。

首次接入其他 Session 仍要求权限与请求一致；未知或不可重建权限仍由正式 profile 校验拒绝。空后继仍在首次使用前初始化继承的权限，不能因它携带来源 profile 就跳过初始化。资源、预设、归属、模型目录、维护屏障及原生 sandbox-aware provider 检查保持生效。

## 验证步骤与记录

测试在真实 SessionController／permissionPresets／Session 持久化／WorkApplication 接缝运行，文件串行、worker 为 1，未增加 timeout 或放宽安全断言。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 修复前，已归属来源权限变更 × live/cold | 4 项稳定失败，错误与运行实例一致 | `docs/artifacts/issue-138-permission-2026-10-26/red.log` |
| 首次接入不同权限的原生 Session | 保持拒绝，不改原权限 | 同上，以及最终整组回归 |
| 最终 execution／continuation 整组 | 2 文件、60 项全部通过 | `docs/artifacts/issue-138-permission-2026-10-26/final-regression.log` |
| 类型检查 | 通过 | `docs/artifacts/issue-138-permission-2026-10-26/typecheck.log` |
| 正式构建 | 通过 | `docs/artifacts/issue-138-permission-2026-10-26/build.log` |
| 构建导出／差异格式 | 32 个导出目标及 sidecar 存在；diff check 通过 | 命令输出 |

新回归包含：新建与复用来源、实时与冷恢复、Full access 与 read-only 的人工切换；恢复后权限事件逐条不变、全局默认仍可新建 workspace-write 会话、保留同一操作与后继；实际后继分别继承 Full access 和 read-only 并成功 delivered。原有多处回执丢失重试、旧协调失权、材料和队列保留、模型与推理强度恢复均一并通过。

验证过程保留了两个测试构造问题和一次中间实现回退：最初用不存在的 `.config.defaultPreset` 断言，改为公开创建独立会话观察默认权限；复用场景改为已有真实原生对话，并先断言 Task 已 ready；中间版本错误地跳过空后继初始化，被原有接续测试捕获并修正。未删除安全断言，也未把中间失败算作通过。

## 运行实例恢复

修复前截图为 `docs/artifacts/issue-138-permission-2026-10-26/permission-failed-before.png`。现有 GUI 为 [DSH](http://10.126.126.12:3080)，未新建替代服务器。

修复通过 [PR #277](https://github.com/a2d2-dev/dsh-plugin/pull/277) 合并为 `8a1dc4b51931a40b7b807858dc06f2ed43dc3b66`，Node 22／Node 24／secrets CI 全部成功。正式 Host/profile 公开解析预检通过后，使用独立 release `a2d2-138-permission-a0dd06e` 与 Cordis patch／`pluginManager/setPluginEnabled` 正式生命周期热重载；回执为 `application: applied`、`warnings: []`。公开 `listPlugins` 确认唯一启用的工作协调挂载为 `include:a2d2-work-138-permission-a0dd06e`、fiber phase 为 active；旧 #265 挂载已禁用，旧 release 保留。当前前端保留，Host 未重启，未修改宿主内部 Session／tool 存储。

运行恢复已经完成：同一来源、owner、epoch 1 从 `incompatible-session` 恢复为 `ready`，`permissionPreset` 与 `actual` 均为 `danger-full-access`／`never`，`reasoningEffort: high` 保留。随后从真实原生页面点击“重试本次接续”，宿主发出正式材料请求，来源保存后停止；固定操作 `e55b31d6…` 与固定后继 `session-7f523df6…` 均复用。修复前后截图为同目录的 `permission-failed-before.png` 和 `permission-recovered-after.png`。

2026-10-26，固定后继实际接任同一个 Task，公开 `task.detail` 为 `ready`、epoch 2、continuation phase `delivered`，请求和 kickoff 均 `delivered`；后继 actual 保持 Full access／never／high。旧来源列在 `retired`，其 `session.work` 投影为 `purpose: history` 并指向这个后继。原 GUI 刷新后显示“接续内容已投递”，旧来源关联入口实际打开当前后继；Task 的“只读历史”显示旧来源记录，读取后 epoch／current／retired 保持不变。决定与具体未完成项在后继页面可以展开。最终截图和筛选后的公开事实保存在 `docs/artifacts/issue-138-final-2026-10-26/`，详见[整票验收记录](issue-138-execution-acceptance.md)。

运行页面初次点击后立即读取曾抓到投递前快照，等待刷新完成后已确认 delivered；等待脚本曾返回 DOM 对象而触发 CDP 序列化错误，改为布尔条件后通过。这些是观察脚本／时序问题，没有将其算成产品回归，也未以旧诊断回执覆盖当前权威查询。
