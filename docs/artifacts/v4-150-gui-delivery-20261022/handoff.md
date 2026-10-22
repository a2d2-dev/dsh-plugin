# 交接（2026-10-22 06:55Z，主会话 #152）

本文件是给后继会话/人的唯一入口；详细证据见同目录 `report.md`、`continuous-serial-snapshot.json`、各 issue 评论与 QA 分支 `test/152-preview-live`。

## 现在的事实

- **GUI 18781**：同 URL 已更新过一次（v4 + #163 修复，client `6e98f56f`、host `8282d612`、启动器 `launch-v4.py`），外部地址 `http://10.126.126.12:18780/`，口令 `/data/_dsh-dev/web-password`。首次更新证据 `/data/_dsh-dev/deployments/v4-gui-20261022T032900Z/`，原会话/工作区全部保留、删除路径 0。
- **最终更新（未完成）**：把 `#163+#165+#167` 组合构建（tgz `120aea75`、client `85abb961`、prep `/data/_dsh-builds/v4-167/profile-new`）装到 GUI。第一次尝试被 runner 自身 bug（`grep -F "--port 18781"` 被当作选项）误判失败并自动回滚；实际新实例当时已健康。runner 已修（`grep -F -e`、增加 `/proc/<pid>/cwd` 校验、改 tail 新鲜的 `web-stdout.log`），dry-run 通过。
- **preview 18782**：`http://10.126.126.12:18782/`，组合构建已装（client `85abb961`）。
- **产品缺陷**：#163 已修（PR #164 Draft）、#165 已修（分支 fix/planning-basis-stability HEAD 4f359b8）、#167 已修（分支 fix/planner-payload HEAD 9096e0d）；#166（390×844 横向裁切）只登记未修。均未合并，等维护者。
- **#154/#155 已关闭**；#152 部分通过（核心链路 + 真实自动接续 + 持续委托串行调度通过；B 完成/A 恢复/越界拒绝未完成）。

## 下一步（按顺序）

1. 用 `http://10.126.126.12:18780/` 确认 GUI 健康（应仍是 #163 build）。
2. 执行最终更新：`bash /data/_dsh-dev/deployments/v4-gui-runner.sh --execute`（建议用 `systemd-run --on-active=45s` 包一层，避免重启打断本会话）。runner 会备份→装 profile→supervisor 重启→健康等待→真实浏览器核对面板→inventory 按路径比对（只在路径消失时算 loss）→失败自动回滚。
3. 切换后核对：同 URL 出现 A²D² 控制面板；`sessions` 路径集合只增不减；`profiles/web/node_modules/dsh-a2d2/lib/client.js` = `85abb961…`；GUI 进程 cwd = `…/v4-141-release-8282d612`。
4. 在 GUI 上复用已有 repo 来源，点「持续委托」→ 真实模型计划（46 Issue 来源应成功，这是 #167 的 GUI 侧证明）。
5. 收口 tracker：#152 记录剩余未验证项（B 完成→关闭 #161→A RESUME；越界 node 拒绝；B 模型判断问题）；#150/#136 按实际状态收口；看板同步（#154/#155 Done、#152/#150/#136 In Progress）。
6. PR 由维护者合并（#149、#164 与两个修复分支）。

## 不要做

- 不要用 `127.0.0.1` 做用户侧验收（用户明确要求 10.126 地址）。
- 不要为中间版本反复重启 GUI。
- 不要把未验证项写成通过；不要代维护者合并 PR。
