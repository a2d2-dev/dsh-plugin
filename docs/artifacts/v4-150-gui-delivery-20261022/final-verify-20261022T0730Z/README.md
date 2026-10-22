# 最终同 URL 核对：GUI 组合构建 + 真实模型计划（2026-10-22 07:19–07:31Z）

主会话：#136 CEO 主会话（父 #150），承 #152 收尾轮次。全部核对走外部地址 `http://10.126.126.12:18780/`（socat → 127.0.0.1:18781），口令文件 `/data/_dsh-dev/web-password`。

## 1. GUI 已是组合构建（无需再跑 runner）

- 切换发生于 2026-10-22T06:56Z，由服务外受管 runner 以 `systemd-run --on-active` 延迟执行：`/data/_dsh-dev/deployments/v4-gui-20261022T065636Z/runner.log` → `RESULT=updated-and-verified`，`LOST_PATHS=0`。
- 组合构建标识（本轮独立复核）：
  - `profiles/web/node_modules/dsh-a2d2/lib/client.js` sha256 = `85abb961124628ef0ca8eaf5f72ed010635f3c21bf2295ec1678a03db376ae8f`（schema 期望值）。
  - GUI CLI pid `749945`，启动于 2026-10-22T06:56:38Z，`/proc/749945/cwd = /data/src/github.com/deepseek-ai/deepseek-harness-dev.worktrees/v4-141-release-8282d612`；该工作树 `git HEAD = 8282d61299`。
  - `supervisor conf command = /usr/bin/python3 /data/_dsh-dev/profiles/web/launch-v4.py`；启动器 exec 上述 8282 宿主 CLI，`--port 18781 --trusted-host 10.126.126.12:18780`。
- 浏览器实际拿到的 bundle 与磁盘文件一致：从登录会话抓取 `/plugins/??dsh-a2d2/client.js&rev=a7da043b78de`（200，353,942 bytes），把服务端注入的 `sourceMappingURL` 行还原后 sha256 = `85abb961…`（逐字节相等），排除"磁盘换了、服务端仍发旧 bundle"。
- 外部入口：`http://10.126.126.12:18780/` 返回 401 登录页，用新口令登录成功。

## 2. 面板 / 来源 / 原数据保留（按路径集合）

- 侧栏出现「A²D² 控制面板」；五个原工作区仍在：task-interaction-v3、plugin-only-compat、a2d2-dev、edge-platform、runtime-verification；原会话列表（含「继续完成任务交互原型工作」「Untitled」多条）保留。
- 来源保留：仓库来源 `a2d2-dev/dsh-plugin`，`读取账号：imneov`，概览 44 开放 Issue / 74 PR，缓存观察时间 2026-10-22T03:38:20.905Z。
- 保留比对按**路径集合**（`inventory-now.txt` 与切换前 `deployments/v4-gui-20261022T065636Z/pre-inventory.txt`）：pre 217 路径 / now 219 路径，`LOST_PATHS=0`，新增仅 `sessions` +2（本会话与重启后的会话文件），storages 1→1、a2d2 4→4、projects 4→4。

## 3. GUI 侧真实模型计划（#167 修复的 GUI 证明）

在 GUI 上对 repo 来源点「持续委托」，用真实模型跑计划。三次真实调用（全部 HTTP POST `/a2d2/api/work` `continuous.preview`，`codex/gpt-6.1-sol` 与 `deepseek-official/deepseek-flash` 由面板选择）：

| # | 模型 | 时长 | 结果 |
| --- | --- | --- | --- |
| 1 | deepseek-official/deepseek-flash | 32.4s | `planning-execution-mismatch`：模型把 #160 标成 `existing`，但仓库里没有任何 canonical Task/execution（判断错误，非载荷问题） |
| 2 | deepseek-official/deepseek-flash | ~50s | `planning-model-failed: Model stopped with max-tokens; requestCharacters=16386, candidates=47` |
| 3 | codex/gpt-6.1-sol | 28.4s | **成功**：plan v1，3 步，#152 `new` → #150 `wait` → #136 `wait`，含 why/nextAction |

关键量：#167 修复前请求体约 350–400KB（preview 实测 source 328,892 bytes）；GUI 侧现在 `requestCharacters=16386`（47 候选），落盘 basis JSON 21,835 chars。模型真实返回并解析成功，说明"整份来源观测塞进 basis 导致模型 stopped"的失败模式在 GUI 已消失。

计划原文（`continuous-status-planv1.json`）：

- v1：`createdAt=2026-10-22T07:29:33.772Z`，`draftVersion=3`，steps：
  1. `#152`（nodeId I_kwDOUmfSE88AAAABY9AauQ）`new`
  2. `#150`（I_kwDOUmfSE88AAAABY86SwQ）`wait`
  3. `#136`（I_kwDOUmfSE88AAAABYxYq_A）`wait`
- 规则 version 5、`enabled=false`、未启用、未创建任何 Task/Execution（本轮只做预览）。

### GUI 侧状态改动（本轮引入，便于后继接手）

- 该来源此前**没有**持续委托规则（面板显示「接新工作已暂停」为未配置默认文案）。本轮为跑计划新建了规则 `ef81e9a7-ee24-4378-9a93-ee42e81b210a`：先 `continuous.configure`（v1，resource=task-interaction-v3、model=deepseek-flash），再两次 `continuous.instruct`（主委托 + 补充），再用面板把模型改成 codex/gpt-6.1-sol（v4），预览成功后规则 version 5。
- 规则当前：`enabled=false`、`plans[0]` 为 plan v1、`items` 47 项全部 `skipped`、无 `active`、**未创建任何 Task/Execution**。未启用计划，因此没有真实工作在跑。
- 工作库：`/data/_dsh-dev/a2d2/work-v3/work-v3.json`（命令历史仅 6 条，可回溯本轮全部写操作）。

## 4. 本轮未验证 / 遗留（不得写成通过）

- B 完成 → 关闭 #161 → A RESUME：未验证（B 仍卡在模型对"串行槽前置条件"的自我判定）。
- 越界 node 拒绝：仍未构造真实场景。
- B 模型判断问题：仍在（模型无视宿主推进槽证据）。
- 新观察（本轮如实登记，未定性为产品缺陷）：47 候选 + deepseek-flash 时模型 `max-tokens`；模型对"已存在/不存在 canonical 执行"的判断可能与工作库事实不一致（#160 被判 `existing` 而库中 0 Task/0 Execution）。
- #166 窄屏 390×844 横向裁切：只登记未修；本轮未复测。
- 分页稳定、PR 关闭空结果、后台 job 收取分层、关闭冲突补偿：沿用前次未验证结论。

## 5. 文件

- `gui-plan-v1.png` / `gui-plan-v1-full.png` / `gui-plan-v1-text.txt`：面板与计划 v1 页面。
- `continuous-status-planv1.json`：`continuous.status` 原始返回（规则 v5、plan v1）。
- `preview-planv1.har`：第三次调用的完整 HAR（含 HTTP 200 与 28.4s 时长）。
- `inventory-now.txt`：本轮保留比对用的当前清单。
