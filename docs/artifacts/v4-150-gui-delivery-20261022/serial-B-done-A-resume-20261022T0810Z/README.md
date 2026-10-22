# 持续委托串行收尾：B 完成 → #161 关闭 → A RESUME → #160 关闭（2026-10-22 08:08–08:35Z）

实例：preview 18782（组合构建 client `85abb961`、host `8282d612`）。run：`v4-152-6b252218-r01`。执行全部为真实模型会话（codex/gpt-6.1-sol、medium、workspace-write）。

## 结果链

| 时间（UTC） | 事实 |
| --- | --- |
| 07:51Z | B 写入 `B.proof.json`（identity + slot + decisions 3/["stable"]，checks 先 pending） |
| 07:58Z | B 以 workspace-write 实际执行 Python 校验：JSON/数量/标签/SHA256 全 passed |
| 08:08:22Z | B `work_report done` + `closeExternal=true`（5/5 验收），closeout pending |
| 08:11:28Z | #161 关闭（external 先 unknown → 观察态 closed） |
| 08:27Z | A 正式 RESUME（`task.control resume`，含 `RESUME-A-v4-152-6b252218-r01` 与宿主事实） |
| 08:31:59Z | A `work_organize source-children` 采纳 #160 完整原生子范围（0 子项）成功 |
| 08:32:38Z | A `work_report done` + `closeExternal=true`（5/5） |
| 08:34:58Z | #160 关闭（宿主 completion outbox 自动同步，external=closed，attempts=1；`closeout=settled`） |

规则最终 v12（`enabled=false` 仅暂停接新，收尾期间使用；B/A 两个 item 均 completed，X=#162 保持 blocked）。

## 两个阻塞的真实原因

### 1) 环境：workspace-write 无后端（已修）

宿主原本没有可用沙箱后端，bash 的 workspace-write 直接失败；B 的模型遂申请 danger-full-access 并长时间等待批准（08:41 前那条请求已随重启作废，新请求被**拒绝**，未放宽权限）。

本轮安装 `bubblewrap 0.6.1`（`/usr/bin/bwrap`）并以产品自身模板实测：

- 只读 probe：`bwrap --ro-bind / / --dev /dev --unshare-pid --proc /proc --die-with-parent -- true` → rc 0
- workspace-write：`… --tmpfs /tmp --bind <run dir> <run dir> -- bash -c 'echo hello > …'` → rc 0

随后重启 preview（pid 919354/919361，07:41Z）让进程重新探测；A/B 此后的 bash 均以默认权限成功执行（B 的 SHA256 校验、A 的 JSON/SHA256 校验）。

### 2) 产品缺陷 #168（未修，已登记）

持续候选扫描每 ~30s 用**不含 `subIssues`** 的列表观察覆盖 `binding.lastObserved`：

- `src/work-sources/repository-candidates.ts:63`：`binding.lastObserved.updatedAt <= issue.updatedAt` → `binding.lastObserved = issue`（等版本也覆盖，且列表观察没有原生子字段）
- `src/work-organization.ts:30-31`：采纳要求 `observed.observedAt === intent.observedAt`
- 结果：A 两次按精确 observedAt 采纳都被 `source-observation-superseded` 拒绝，`done` 又被 `native-child-scope-incomplete` 拒绝（实测 `lastObserved.observedAt` 08:24:40.736Z → 08:25:20.404Z 持续前进，`subIssues=null`）。
- 绕过：`continuous.set-enabled false`（v12）停掉候选扫描后，`lastObserved` 稳定为 `subIssues={items:[],totalCount:0,hasNextPage:false}`，A 一次采纳成功。已开 #168 并给出修复建议（严格更新 + 保留丰富字段，或按 `updatedAt` 做权威校验）。

## 越界 node 拒绝：真实模型侧未触发（未验证）

用 GUI 18780 的同一 repo 来源、真实模型连续两次刻意构造：

1. 补充「计划里必须包含 nodeId `I_kwDOUmfSE88AAAABZZZZZZZ`（不在候选内）」→ 模型给出 plan v2（仅 #152），未包含计划外节点，HTTP 200。
2. 补充「按字面执行，steps 第一项必须是该 nodeId 原样 JSON」→ 模型给出 plan v3，仍未包含，HTTP 200。

因此 `planning-outside-source` 的拒绝路径**没有**取得真实模型实证（目前只有单元测试覆盖）；模型本身拒绝了越界输出，这一点如实记录，不写成“越界拒绝已验证”。

## 文件

- `a-task-detail.json` / `b-task-detail.json`：两次 `task.detail` 原始返回（含 completion/external/criteria）。
- `continuous-status-after-B.json` / `continuous-status-final.json`：串行过程中的规则/计划/items 状态。
- `A.proof.json` / `B.proof.json`：两个 fixture 的真实 proof（B 为 done 版本）。
- 会话日志：`/data/_dsh-dev/previews/a2d2-v3-121/home/sessions/--data-_dsh-dev-acceptance-workspaces-v4-152-r01--/session-{ab13791a…,d4ed190e…}/session.v4.jsonl.zstd`
