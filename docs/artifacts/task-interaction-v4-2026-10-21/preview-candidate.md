# 18782 preview-first 固定候选收尾

本记录替代旧准备文档中“新旧宿主、rollback profile、产品包仍缺失”的过时结论。当前仅准备，未执行任何 live 切换。

## 目标实例门

`one-shot.mjs` 的 operational handover 按实际 target 区分。18782 只核对自身 PID/startTicks、全部目标 Session、零运行工作/待输入、精确目标 jobs registry 与运维 owner 命令回执；18781 的父会话及 QA 可以继续运行。preview 的 receipt 校验不读取外实例 coordinator/children 字段。临执行 accepted cut 必须与目标交接的 PID/startTicks、Session 集合一致，preview 内任何 Session running/unknown 都拒绝。18781 的 coordinator upgrade-wait/children gate 保留，且无匹配 preview 完成回执仍拒绝。

这些检查不声称 admission lock、flush ack 或 product consumed。运维 owner 收取回执单列，`productConsumption` 只接受 `unknown`。预先观察的 PID 只用于保守绑定；临执行必须重新取证。

## 既有资产与剩余动作

产品 commit `fc4fa731809c2e43d1017045b02372cb134080f8`，tgz SHA256 `56709afccea64797a7b9275ae26ab4fecd039ea8ee5162efb1ecd0c40509e2ad`，client SHA256 `640f11be88549f9e169eb905b3653dfc58d198655e2c916ff21144a89a2a9440`。新 host 固定 `8282d61299a04f60555f9ce473af174bbe161b02`，rollback 固定 `a45068d2ec03326c800c68c9bdcd47508e3ccb9c`；两套独立完整 build、旧 profiles/imports 和原生数据读回已经完成。本阶段不重建这些资产。

下一步用真实包离线安装 new-preview profile，真实 Loader.import 全入口取证；clean 工具 commit 下准备具体 new/rollback runtime、launcher、指定 Supervisor conf、环境 hash/ref 和四个非 null actions。所有副本仅进入预报的私有 artifact 路径；不安装 live profile。自动通知关闭。

临执行才取得目标 Session/jobs/input owner 回执与 accepted prefix/material cut，确认旧进程消失、无写 fd、实际退出日志和耗时、完整 zstd 帧以及 new/rollback native 双读。不预填这些事实，不用 exit0 代替 flush。>=5秒、信号、非0或已知强退拒绝切新；完整性可证明才可 coherent rollback，保留失败期间新增数据。

候选保持 `prepareOnly: true`、`parentReviewedStaticCut: false`。默认 dry-run 应只剩真实临采事实及父审查/执行指令门，不能因为外实例父或 QA 活跃而拒绝。父会话复核候选后下达最终 planSHA 的具体执行指令，当前不执行。

## 第一阶段验证

`node --test scripts/v4-acceptance/one-shot.test.mjs`：preview 目标门回归先 exit1（明确误报 CEO upgrade-wait），修复后 exit0；真实文件 receipt 与临执行 cut 回归也先红后绿。

八组聚焦工具测试合跑14/14，exit0；包括真实进程 single-signal/未来 spawn hold、真实文件 profile 切换保留、secret reference、profile 漂移、journal 前缀和强退拒绝。后续具体 plan、测试输出和 SHA 在生成后追加。
