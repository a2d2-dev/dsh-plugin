# #121 整合评审与裁决

固定规格基线：`e9dc56bdc022cfdfa259bc5f1e04b931249bb102`。本轮唯一最终 review HEAD：`9588b5347595b4adc045a747271284912ea0088a`；46 文件，2758 additions / 282 deletions。最初 `a3b8dc0` 到最终 HEAD 只增加验收工具与阶段证据，产品代码未变。

两轴均 fresh context、只读，以 `git diff <base>...<head>` 加相关源文件全文核查。实际工具回执均为 `codex/gpt-6.1-sol` / `xhigh` / `reviewer`。正式产品浏览器验收仍在并行，host-only 记录不作为产品已通过的证据。

## Standards

评审会话：`session-25926e66-1382-46e6-9aee-95485e5e336d`。结论 **REQUEST_CHANGES，2 项 P2 必要修**。

1. `src/client/work-panel.tsx:99` 在可信 UI 命令前 trim 目标、规格、验收，破坏完整材料。实际表单回调的内存验证显示 `"\n    preserve code indentation\n"` 不编辑再次保存后变成 `"preserve code indentation"`。与 ADR-0003 完整保存契约冲突。后端直接命令测试绕过表单，不能证明 UI 保留原文。
2. `scripts/a2d2-v3-121/acceptance.mjs:31–34` 先递归 mkdir，再检查 realpath。命名空间中的 symlink 指向外部时，会先在外部创建子目录再拒绝。评审以真实 prepare 和虚拟文件边界核对执行顺序；没有实际越界写入。与本票隔离环境及工具自身路径边界承诺冲突。

已核查认证先于 body 且接收后复核、严格资源引用、锁内去重/版本与资源唯一性、观察关联不授协调权、客户端 import purity。没有额外重构建议。

## Spec

评审会话：`session-e611fd47-185c-431a-a925-422f6bda7cb1`。结论 **REQUEST_CHANGES，1 项 P2 必要修**。

`src/client/work-panel.tsx:94、99` 把已有验收数组 join 成一个 textarea，保存时按换行拆分并 trim。公开命令允许 `['先验证A\n再验证B']` 这样的单条多行验收；UI 只改目标也会把它变为两条，并裁剪未编辑规格。违反第01票 AC3 的“完整目标/规格/验收”。与 Standards 第一项合并整改。

非阻断证据建议：`tests/work-process.spec.ts:106` 先取得结果再杀 writer，证明的是提交后崩溃重放，不是调用方确实未收到回执。应收紧证据措辞；本票不增加新的故障窗口需求。

其余已检查生产 API 装配、宿主认证与路径/资源验证、命令唯一性、会话导航及异步防过期，未发现其他必要修。

## CEO 裁决

| 编号 | 来源 | 裁决 | 关闭依据 |
| --- | --- | --- | --- |
| R1 | Standards P2-1 / Spec P2-1 | **修**：保留目标、规格和每条验收的原始内容与条目边界；仅以裁剪结果判空，覆盖真实表单提交/编辑往返 | **已关闭**：`9e31834`、CEO 整合回归及新包真实 UI 证据；`product-final-8d33081` 的 08/10/11 JSON 证明创建、仅改目标、无改动重存均逐字保留材料与验收条目边界 |
| R2 | Standards P2-2 | **修**：任何 mkdir 前验证现存规范父路径；用真实隔离临时 fixture 证明逃逸拒绝前外部目标没有新增内容 | **已关闭**：`a689c56`；CEO 核对前置校验及真实 fs 测试，独立工具测试 7 项通过 |
| R3 | Spec 证据建议 | **记账并收紧说明**：更正已有测试名称/说明的证明范围；不补新故障窗口、不改变原断言 | **已关闭**：`7127b6d` 仅改名称/表述，原步骤与断言保留 |
| C1 | CEO 产品文案核对 | **修正文案**：去除“当前票不启动执行”的开发票据术语，保留准确的当前未启动状态 | **已关闭**：`9e31834` 文案及渲染测试已核对 |
| R4 | 真实浏览器验收准备 | **修**：guard seed 使用公开 WorkspaceController 返回的 `workspace.workspaceId`，不使用不存在的 `workspace.id`；验证创建 Session 的引用与实际 cwd | `44175de` 的真实 controller 测试已核对，包含正确 cwd 和 Workspace 成员关系；待 fresh root 重启验收 |
| R5 | 首轮真实浏览器 AC7 缺陷 | **修**：blank Session 不渲染 header.actions；将工作入口迁到 blank/普通会话共享的公开 `conversation.input.dock` list，保留已有 single corner 控件 | `f482b15` 已核对公开宿主两种状态渲染及注册/返回测试；待最终原生来回导航 |

采用一轮制：统一高级整改后 CEO 直接核对以上清单，不再次派评审扩大范围。产品浏览器发现若击穿验收，仍在本票修复。

## 既有运行器超时的基线对照

诊断会话 `session-13680870-542e-4703-98d3-61fefe02a491`，实际路由 `codex/gpt-6.1-sol/xhigh`。固定比较 e9dc56b 与 a2573ac；运行器、原测试、Vitest 配置及两固定提交的锁文件没有差异。后续整合安装曾改变顶层依赖链接，诊断随后固定相同物理包路径再次成对验证。

- slow-successor：未加观测的基线曾 4319ms 通过、5075ms 超时；当前 5504ms 超时。固定依赖的两次成对观测分别 5054ms（基线）/5087ms（当前）超时。原固定 2300ms 持锁与真实 JSONL 多次 fsync 共用 5000ms 整例预算。早期入队/去重断言通过，末尾交接断言未到，不能报告整个用例语义通过。
- in-flight-question：固定依赖精确对照在基线 1434ms、当前 1060ms 均通过。原全量超时未复现；没有证据将其因果确定为 slow-successor 的同一原因。
- CEO 已回读诊断耗时摘要及原基线 5075ms 超时日志。fsync 观测支持真实 I/O 延迟影响；不能指定哪个外部进程导致磁盘变慢。

裁决：**记账，保留全量测试退出 1 的真实记录**；未发现 #121 独有回归，不改旧运行器/断言/超时。本票相关整合测试 258/258 通过，工具默认测试 3 通过、2 个需要真实宿主的用例显式未选；真实宿主 lane 必须另提供证据。

原始诊断记录在 `/tmp/a2d2-v3-121-diagnose/run-1jxa8zp3/`；本文件保留可复核结论和限制，后续无需依赖临时目录才能理解裁决。

## 整改后的 CEO 独立验证

在产品整改 `433e986` 与保留首轮失败证据的整合提交 `8d3308112f3affb91767b5976a8d1d2d950c921b` 上，CEO 独立执行：

- `XDG_STATE_HOME=/tmp/a2d2-v3-gh-state pnpm test`：48 个文件、**696/696 通过，退出 0**。两个原运行器用例此次分别 4101ms（slow-successor）、1111ms（question），全部原断言到达。此结果不抹去此前真实超时，也不宣称已修复 I/O 耗时脆弱性；运行器与其超时未改。
- `pnpm typecheck`：退出 0。
- `node --test tests/a2d2-v3-121-acceptance.test.mjs`：**7 通过，2 项需要真实宿主的用例显式未选，退出 0**；真实 fs symlink 拒绝及真实 controller seed 契约通过。
- `pnpm verify:pack-exports`：退出 0，真实构建、打包、临时安装并导入 13 个 Node 导出。
- `git diff --check`：退出 0。

复验包：`/tmp/a2d2-v3-121/artifacts/candidate-8d33081/dsh-a2d2-0.0.1.tgz`，SHA256 `81466a33342c0256873bbf30dac693ee0cff2c075246a4ad859d94663ce0a82b`。已指定独立浏览器 lane 使用该包和同一固定工具提交，在全新隔离 root 复验；此处仍未将浏览器 gate 提前标通过。
