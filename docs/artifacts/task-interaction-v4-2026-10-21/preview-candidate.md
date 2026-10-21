# 18782 preview-first 固定候选收尾

本记录保留准备历史。#150随后写入真实SHA绑定指令并授权唯一18782切换；实际尝试失败，当前独立a450 rollback已在原URL运行，新版本未应用。详见[实际运行中文记录](preview-deployment-154.md)、[脱敏机器实录](preview-deployment-154.json)与[追加只读CDP诊断](preview-cdp-diagnosis-154.json)。原final plan已使用一次，原lock和全部失败证据保留；不得据以下历史prepare状态或deployed计划指纹误称成功，亦不得复用本run重试。

## #154 最终plan准备快照（执行前历史）

O-F1/O-F2已按唯一review #151的CEO裁决闭合；见[整改记录](ops-remediation-154.md)、[27/27真实工具TAP](ops-tool-tests-154.tap)和[离线CDP证据](offline-cdp-proof-154.json)。工具clean freeze为 `5a2ecf35abd4ea64e543e0ef7e64a690a6ed4368`。26个工具（原24加shutdown-log/browser-response）逐文件均与该commit一致，集合SHA256 `55b0cd03fd5a7b9d0e3184c00d70c064ec63be226568d24c12c72c432fd5019c`，编码为canonical JSON排序对象keys，数组按文件名顺序，仅含name/sha256。

- 最终plan：`/data/_dsh-builds/v4-141-artifacts-38d4d91/preview-final-154-5a2ecf3-02/final-plan.private.json`
- 最终plan SHA256：`4d75ba31e211873b1f9e47f4a9ee70ec8958c9e2befe931e30cd1fdfde6951e7`
- 原始prepared plan同目录另存，SHA256 `9a306d22b4ae5c5da11339f545b5a6440dc7e32cd86c68a520d85b5a0ca13d20`，prepareOnly=true/static review=false，原字节未改。
- coordinator唯一为当前#150主会话 `session-74fb5e20-1456-461b-b5c1-ef5f3b41e018`，requestRef `https://github.com/a2d2-dev/dsh-plugin/issues/150`。旧父136是历史，不代其授权。

CEO在本次主子会话消息中明确授权最终准备开关 `prepareOnly=false`、`parentReviewedStaticCut=true`；此授权仅用于生成最终plan。plan保留 `staticPreparationInstruction.executionAuthorized=false`；绑定最终SHA的 `executionInstruction` 指向 `/tmp/a2d2-v4-154-5a2ecf3-02/parent-execution-instruction.json`，文件实际不存在。不得把两个准备开关当成发信号或execute授权。

实际默认dry-run（不带execute）exit1、ready=false，[完整输出](preview-final-plan-dry-run-154.json)只剩 `invalid real handover: ENOENT ... /tmp/a2d2-v4-154-5a2ecf3-02/operational-handover.json`。执行指令在execute路径另查；dry-run不检查它不代表已授权。目标PID/startTicks只在准备时采只读metadata，执行阶段必须重新绑定；target Sessions/input/jobs/cut未伪造。18781父/QA不被该目标门阻塞。

[new/rollback完整指纹和26工具SHA](preview-final-plan-summary-154.json)包含四actions（同一真实dispatcher，四个kind）、runtime、launcher、指定conf、env policy和imports。两套真实Loader.import各256；没有重建固定产品或Host。旧659f候选和已撤回6d80候选私有原字节均已重算保持；最终raw evidence恢复既有私有tmp合同，避免live-cut路径不一致。未发信号、stop/start/restart、修改live profile或模型验收；真实18782 HTTP/UI/SW/cache控制仍未验证。


## 目标实例门

`one-shot.mjs` 的 operational handover 按实际 target 区分。18782 只核对自身 PID/startTicks、全部目标 Session、零运行工作/待输入、精确目标 jobs registry 与运维 owner 命令回执；18781 的父会话及 QA 可以继续运行。preview 的 receipt 校验不读取外实例 coordinator/children 字段。临执行 accepted cut 必须与目标交接的 PID/startTicks、Session 集合一致，preview 内任何 Session running/unknown 都拒绝。18781 的 coordinator upgrade-wait/children gate 保留，且无匹配 preview 完成回执仍拒绝。

这些检查不声称 admission lock、flush ack 或 product consumed。运维 owner 收取回执单列，`productConsumption` 只接受 `unknown`。预先观察的 PID 只用于保守绑定；临执行必须重新取证。

## 既有资产与剩余动作

产品 commit `fc4fa731809c2e43d1017045b02372cb134080f8`，tgz SHA256 `56709afccea64797a7b9275ae26ab4fecd039ea8ee5162efb1ecd0c40509e2ad`，client SHA256 `640f11be88549f9e169eb905b3653dfc58d198655e2c916ff21144a89a2a9440`。新 host 固定 `8282d61299a04f60555f9ce473af174bbe161b02`，rollback 固定 `a45068d2ec03326c800c68c9bdcd47508e3ccb9c`；两套独立完整 build、旧 profiles/imports 和原生数据读回已经完成。本阶段不重建这些资产。

已用真实包离线安装 new-preview profile，并完成真实 Loader.import 全入口取证；在 clean 工具 commit 下生成具体 new/rollback runtime、launcher、指定 Supervisor conf、环境 hash/ref 和四个非 null actions。所有副本仅进入已预报的私有 artifact 路径；没有安装 live profile。自动通知关闭。

临执行才取得目标 Session/jobs/input owner 回执与 accepted prefix/material cut，确认旧进程消失、无写 fd、实际退出日志和耗时、完整 zstd 帧以及 new/rollback native 双读。不预填这些事实，不用 exit0 代替 flush。>=5秒、信号、非0或已知强退拒绝切新；完整性可证明才可 coherent rollback，保留失败期间新增数据。

prepare-plan默认保持 `prepareOnly: true`、`parentReviewedStaticCut: false`；原prepared plan不可覆盖。当前最终plan的两个静态开关按上文CEO具名消息另行授权派生，绑定最终SHA的执行指令仍须另发。以下旧候选与当时dry-run保留历史，不作为当前最终授权。

## 历史具体候选（未执行，已被#154替代）

代码修复提交 `e247236c94f2e27873e312068ff95f01822f5fa3`；计划生成时工作树 clean，固定工具提交 `39fe47ef057cda97afe13ade333e4d0fcf777eff`。后续本记录提交只补交付摘要，不改冻结工具。

- plan：`/data/_dsh-builds/v4-141-artifacts-38d4d91/preview-candidate-e247236/plan.private.json`
- plan SHA256：`659f9d7d6fd17104ae1c4978312250442d75b882172df696237ad8a64f31b64c`
- release manifest SHA256：`1b6279c4761246f98027a2cc58e92c480514fa2741302e414049bf2011651a68`
- build evidence SHA256：`2672d0f22afffd05aaa32a1da72cca710d97bde0dae72cc47f262701d42b4037`。固定产品提交中的 producer 文档原字节，已与 `git show fc4fa731:docs/specs/v4-product-remediation.md` 比较一致；类型为 committed producer command record + CEO independent artifact/regression verification，不是原始 stdout，也不是本轮重跑。
- 四个 actions 均为真实 `profile-actions.mjs` 的不同 kind，SHA256 `28fd62b755ff0c0cd3af2e627da46c955c2f8ebbfc28e785b6d267287ea3d7a6`，没有占位返回0脚本。

生成后的 new/rollback profile 各256个真实 Loader.import（255原入口加关闭的 notifier模块）；notification.enabled=false。两套 profile tree、imports、runtime、launcher、指定conf、env结构hash和24个工具文件SHA见[无密钥候选摘要](preview-plan-summary.json)，完整值在上述私有 plan。single-PID TERM + future-spawn hold 保留，候选conf为 stopasgroup=false/killasgroup=true。

实际默认命令（没有 `--execute`）：

```sh
node /data/_dsh-builds/v4-141-artifacts-38d4d91/preview-candidate-e247236/tools/one-shot.mjs \
  /data/_dsh-builds/v4-141-artifacts-38d4d91/preview-candidate-e247236/plan.private.json
```

命令 exit1、ready=false；[真实输出](preview-plan-dry-run.json)只剩三项：真实临执行 operational-handover 尚不存在、父静态cut审查未完成、prepareOnly授权门。未出现资产缺失或18781父/QA状态阻塞。旧通用 steps 展示文字不构成额外 gate，实际target判断以上述已测代码为准。

静态准备已齐：new/rollback完整宿主、真实新旧离线profile/imports、产品provenance/buildEvidence、成对manifest、四动作、launcher/conf/env候选和single-signal/hold。`stage-profile`、`fingerprint`、`prepare-plan`分别真实exit0。父复核后可以派生最终执行plan，保留被审资产SHA并对最终planSHA另下具体指令；当前prepareOnly/static-cut review位不伪置true。

仅执行时采集：目标PID/startTicks和Session完整集合、目标jobs及owner实际收取回执/零待输入、accepted prefix和域material cut、旧进程消失、实际exit/日志/耗时、无数据写fd、完整zstd与双宿主native静态读回。settlement/liveCut/executionInstruction三个文件实际都不存在；没有制造ready/flush/graceful/product consumed。GUI的真实preview完成回执仍未产生，18781执行门保留。所有本会话jobs已结束并收取；未操作服务、live profile、模型或GitHub业务对象。

## 第二阶段真实 profile 证据

新 profile 已在 `/data/_dsh-builds/v4-141-artifacts-38d4d91/new-preview/profile` 完成隔离安装，命令 exit0；安装日志确认 `pnpm v11.7.0`，没有改全局版本。新旧 preview 的真实 Loader.import 均255项成功，无 activation/模型调用。源 live profile 的前后 SHA 同为 `08ab4ab06c8118177c51b465024c2b343bc2fca4f89d41b50fadd1a71c4ab6dc`。

新 profile tree SHA `e50afe92b5cc9cc312f3f29e18f71e0b0fc7f88d269d3dffd57e8deeb7d545fa`，import proof SHA `2d5c584639088d1e03b33a2f2ffdb4ea164ba825a6430b035d143bccde427790`。实装 tgz/client 与上述固定 SHA 一致。新旧 host smoke 已从旧私有证据复制到持久 `release-e247236`，原文件未改。

最新聚焦工具输出见 [preview-tool-tests.tap](preview-tool-tests.tap)：14/14、exit0；全部 `.mjs` 语法、Python AST（不写 bytecode）和 `git diff --check` 均 exit0。尚未生成 live 交接、停后 cut 或执行完成回执。

## 第一阶段验证

`node --test scripts/v4-acceptance/one-shot.test.mjs`：preview 目标门回归先 exit1（明确误报 CEO upgrade-wait），修复后 exit0；真实文件 receipt 与临执行 cut 回归也先红后绿。

八组聚焦工具测试合跑14/14，exit0；包括真实进程 single-signal/未来 spawn hold、真实文件 profile 切换保留、secret reference、profile 漂移、journal 前缀和强退拒绝。具体 plan、测试输出和 SHA 已在本记录中固定。
