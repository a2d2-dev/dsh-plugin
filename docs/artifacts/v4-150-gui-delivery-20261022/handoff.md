# 交接（2026-10-22 07:35Z，主会话 #136 / 父 #150）

本文件是给后继会话/人的唯一入口；详细证据见同目录 `report.md`（第十二节为本轮）、`final-verify-20261022T0730Z/`、`continuous-serial-snapshot.json`、各 issue 评论与 QA 分支 `test/152-preview-live`。

## 现在的事实

- **GUI 18780/18781 已是组合构建（本轮已核对，无需再切换）**：client `85abb961`（磁盘与浏览器实取 bundle 逐字节一致）、host `8282d612`、启动器 `launch-v4.py`；切换发生于 06:56Z，runner 结果 `updated-and-verified` / `LOST_PATHS=0`。
- **原数据保留（按路径集合）**：五个原工作区、原会话、repo 来源（imneov，44 开放 Issue / 74 PR）均在；07:19Z 复算 `LOST_PATHS=0`。
- **GUI 侧真实模型计划已跑通**：codex/gpt-6.1-sol、28.4s、plan v1（#152 `new` → #150 `wait` → #136 `wait`）；`requestCharacters=16386`（修前 350–400KB），#167 的载荷失败模式在 GUI 已消失。计划仅预览，规则 `enabled=false`。
- **preview 18782**：组合构建（client `85abb961`）。
- **产品缺陷**：#163 已修（PR #164 Draft）、#165 已修（`fix/planning-basis-stability` HEAD 4f359b8）、#167 已修（`fix/planner-payload` HEAD 9096e0d）；#166（390×844 横向裁切）只登记未修。均未合并，等维护者。
- **串行链路已通过（08:08–08:35Z）**：B 完成 → #161 关闭（08:11:28Z）→ A RESUME → #160 关闭（08:34:58Z）。环境侧安装了 `bubblewrap 0.6.1` 让 workspace-write 可用（未放宽权限）。
- **新缺陷 #168**：持续候选扫描覆盖 `binding.lastObserved`（无 `subIssues`、`<=` 覆盖），导致 `source-children` 采纳 superseded、`done` 被 native-child-scope-incomplete 拒绝；暂停接新可绕过。修复候选 Draft PR #169（`applyObservedIssue`，54/54 测试 + typecheck 通过，**未在 preview 复验**），等维护者。
- **#152 仍未完成**：越界 node 拒绝（真实模型两次都拒绝输出候选外节点，守卫只有单元测试实证）、B 模型判断问题；另有 deepseek-flash `max-tokens`（47 候选）模型侧现象。

## 下一步（按顺序）

1. 修 #168（`lastObserved` 覆盖策略），否则持续模式下的父任务完成路径只能靠暂停接新绕过。
2. 越界 node 拒绝仍需要能真实触发 `planning-outside-source` 的构造（本轮两次真实模型尝试均被模型自身拒绝）。
3. 分页稳定、PR 关闭空结果、后台 job 收取分层、关闭冲突补偿仍未验证；#166 未修。
4. PR 由维护者合并（#149、#164 与两个修复分支）；本分支只提交文档与证据。

## 不要做

- 不要用 `127.0.0.1` 做用户侧验收（用户明确要求 10.126 地址）。
- 不要为中间版本反复重启 GUI；本次切换已完成，除非产物再次变化。
- 不要把未验证项写成通过；不要代维护者合并 PR。
