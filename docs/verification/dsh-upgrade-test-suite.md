# DSH 升级可复用测试集（#243）

## 目的与验收分层

把本次升级发现的 API、一次性输出消费、profile 来源与数据回退问题固定为可重复用例。以后先冻结候选并执行分钟级离线回归，再对失败阶段重跑，避免重复人工排查。本测试集的 PASS 只适用于记录的精确候选、插件源码及执行阶段。

- **A：已自动化离线回归**。统一 CLI 执行真实官方 Session/model、jobs fixture；模型为确定性 adapter，不请求真实模型，不启动 Web/SDK Host。
- **P：机器运维准备**。独立私有 staging、profile 来源、schema 基线、停写 checkpoint、全量数据及旧 reader 比较。现有本机准备工具由父任务维护，不随本测试集发布；必须在私有证据索引记录脚本版本、精确命令、输入和实际结果。
- **G：必须实际 GUI/服务验收**。由获得切换授权的服务外执行者完成原实例切换、原登录和原会话验收。A/P 通过不能代替 G。

总体验收必须同时有 A 的阶段报告、P 的冻结和数据证据、G 的实际交互记录。缺一项标为“未验证/阻塞”，不能写“升级完成”。runner 不安装依赖、不修改上游或 live profile/用户数据、不发恢复消息、不执行切换/回退命令。私有日志、配置、凭据、会话、构建产物均不得提交。

## 统一 CLI

入口：[verify-dsh-upgrade.mjs](../../scripts/verify-dsh-upgrade.mjs)。从插件整合树执行，显式选择满足**候选自身** Node engines 的 Node。以下路径是占位符，先替换为实际绝对路径；私有报告的父目录须已存在，每次使用新的子目录。

```bash
/ABS/NODE/bin/node scripts/verify-dsh-upgrade.mjs \
  --host-root /ABS/BUILT_OFFICIAL_ROOT \
  --expected-commit 22ddee3792402c3e70ec5f86a63c3e3e895a2f60 \
  --expected-version 0.2.1-rc.3 \
  --report-dir /ABS/private/upgrade-quick-UNIQUE
```

默认 quick 依次执行 session、jobs，首个失败即停止。缺配置、缺实际构建、SHA/版本/clean 不符均拒绝，不能 skip。下一次候选要更新期望 SHA 和版本，不能因同为 rc.3 而沿用证据。

```bash
# 扩大到普通 unit、旧 Host、Node、typecheck、插件 build、仓库不变量。
# unit-tmp-dir 须预先存在，整个祖先链不得有 .git 文件或目录。
/ABS/NODE/bin/node scripts/verify-dsh-upgrade.mjs \
  --host-root /ABS/BUILT_OFFICIAL_ROOT --expected-commit FULL_40_HEX_SHA \
  --expected-version VERSION --report-dir /ABS/private/upgrade-full-UNIQUE \
  --full --unit-tmp-dir /ABS/NO_GIT_ANCESTOR

# 定位修复后只重跑失败项；没有隐含 build，也不会覆盖旧报告。
/ABS/NODE/bin/node scripts/verify-dsh-upgrade.mjs \
  --host-root /ABS/BUILT_OFFICIAL_ROOT --expected-commit FULL_40_HEX_SHA \
  --expected-version VERSION --report-dir /ABS/private/upgrade-jobs-UNIQUE \
  --phase jobs
```

`--phase` 支持逗号列表或重复参数，合法值为 `session,jobs,unit,host,node,typecheck,build,repository`；与 `--full` 互斥。每次仍执行候选冻结和结束复核；仅跑某阶段不宣称其他阶段通过。阶段失败后保留日志，新报告中未执行的阶段不可沿用为 PASS。合并多次报告时须核对候选构建摘要、插件源码摘要与 Node 一致；源码有改动时按影响范围补测并明确旧报告基线。

| 阶段 | 实际子命令（均由当前 `process.execPath` 执行） | PASS 定义 |
| --- | --- | --- |
| session | `node node_modules/vitest/vitest.mjs run --configLoader runner --no-cache --config tests/official-session.config.ts` | 官方真实公开 API 场景全部通过 |
| jobs | `node node_modules/vitest/vitest.mjs run --configLoader runner --no-cache --config tests/official-jobs.config.ts` | 官方真实 jobs/工具/Session 提交/JSONL 场景全部通过 |
| unit | `node node_modules/vitest/vitest.mjs run --configLoader runner --no-cache --project unit` | 现有 unit 项目全部通过，包括 runner 拒绝测试 |
| host | `node node_modules/vitest/vitest.mjs run --configLoader runner --no-cache --project host` | 现有旧 Host fixture 项目全部通过；不启动服务进程 |
| node | `node --test tests/a2d2-v3-121-acceptance.test.mjs tests/a2d2-v3-121-run.test.mjs` | 两个既有 Node suites 无失败 |
| typecheck | `node --run typecheck` | [package.json](../../package.json) 中既有类型检查 exit 0 |
| build | `node --run build` | 既有正式插件 build exit 0；仅清理/重建已核对的本树 lib |
| repository | `node --run verify:repository` | [verify-repository.mjs](../../scripts/verify-repository.mjs) 不变量全部通过 |

full 的本地 build 只执行一次；quick 和失败阶段重跑不 build。排障时可用 `node scripts/assert-pack-entrypoints.mjs` 检查已有产物。最终提交仍须按仓库规范运行 `pnpm verify:pack-exports`：它有意从干净归档重新构建、打包并安装验证，已有 lib 的检查不能替代它。将该发布门集中在最终提交固定后运行，避免每次排查都重复 prepack；见 [打包校验器](../../scripts/verify-pack-exports.mjs)。

### 冻结、运行环境与报告

预检要求候选是精确 Git 根、HEAD 等于完整 SHA、Git tracked/untracked 状态干净、root/CLI/必需官方包版本匹配且关键构建入口非空。记录候选 packages/vendor/CLI/native 的 manifest、现有 lib 文件、native 平台二进制、Web dist、lockfile 的逐文件 SHA-256 与汇总摘要；按官方长度分帧算法重新计算 client build record 的文件数和摘要，要求 profile=official、提交前缀和版本匹配，不能只相信记录里的值。结束再次比对 SHA/clean/version/build。构建 symlink 越界拒绝。它冻结**实际被测试的文件**，不替代完整依赖树/发行来源审计、可重复构建证明或实际 Web/桌面功能验收。已有构建缺失时应在候选维护流程补建并重新冻结；runner 不为上游重建。

Node 使用当前 `process.execPath`；root 或 CLI engines 不满足就拒绝，不静默换 Node。当前候选要求 `>=24.9.0`，Node22 会拒绝。支持比较运算符和 `||` 的数字版本范围，遇到未支持 engines 语法会明确拒绝，先更新校验器再运行，不能猜测通过。

runner 显式传入 `DSH_OFFICIAL_HOST_ROOT`、`DSH_OFFICIAL_HOST_COMMIT`、`DSH_OFFICIAL_HOST_VERSION`。fixture 的当前默认是上述 SHA / rc.3；未来版本仍须更新真实合同断言，传 env 不等于自动支持新 API。官方 fixture 的临时根固定为插件树 `.local/tmp`。unit/host 另外使用无 `.git` 祖先的私有临时根，避免 markerless 用例错误走到父仓库；可用 `--unit-tmp-dir` 指定。其余子进程使用插件临时根。隔离 `DSH_HOME`、HOME/USERPROFILE、profile 目录及 XDG config/state/cache 到新报告下的私有位置，清除子进程 `NODE_OPTIONS` 和原会话/服务定位变量，避免依赖当前 Host 的隐式解析 hook。

优先查看 `summary.json`：它只保留阶段状态、退出码、耗时、候选/插件摘要及日志索引；完整逐文件来源保留在 `report.json`。

报告目录以 0700 创建，日志/JSON 为 0600，已存在目录拒绝覆盖；插件树内须为 Git 忽略路径，禁止写官方候选和 live DSH_HOME。输出 JSON 包含：范围与 GUI/profile `not-run` 标记、候选及插件来源摘要、Node 路径/版本、临时根、每阶段 argv/cwd/exit/signal/duration/log/provenance、结束冻结复核和总状态。预检拒绝发生在创建报告/fixture 临时目录之前，exit 1 与 stderr 即证据；不伪造一个测试报告。阶段 exit 0 且最终冻结复核通过才算该次离线 PASS；错误、取消、非零 exit、构建或源码中途改变均 FAIL。

## A：自动化用例矩阵

下表“已自动化”指存在真实断言；本轮实际执行数量见末尾记录，不把历史全套通过冒充本轮证据。[Session 报告](issue-243-official-session.md)、[jobs 报告](issue-243-official-jobs.md)、[整合报告](issue-243-integrated-compat.md) 保存问题背景。所有 Vitest 命令都须带 `--configLoader runner --no-cache`。

| ID / 状态 | 问题与操作 | 文件 / 命令入口 | PASS / FAIL 定义 |
| --- | --- | --- | --- |
| A01 已自动化 | 同版本 npm/master API 不同；同版本不同 SHA、不干净候选、未构建源码均不能冒充候选 | [runner 预检测试](../../tests/dsh-upgrade-runner.spec.ts)，`--phase unit`；quick 的来源冻结 | 拒绝错误 SHA/dirty/低 Node/缺构建；候选和 live sentinel 不变、服务/install trap 未调用。版本相同但误放行即 FAIL |
| A02 已自动化 | 用官方公开 `Agent.model.current/select` 选择本地 provider/model/effort，校验 catalog 与 adapter | [official-session.integration.ts](../../tests/official-session.integration.ts)，`--phase session` | 本地选择持久化、全局默认不变；缺公开能力明确拒绝。调用全局默认写接口或污染其他 Session 即 FAIL |
| A03 已自动化 | Root/execution create 丢回执、冷恢复及重试；保持预留 id | 同上 | 首次按官方合同创建，恢复 resolve 固定 id，不通过 blank reuse 重复 create；identity/error 不符拒绝。产生另一个 Session 即 FAIL |
| A04 已自动化 | preset 在 publication 前装配；权限继承；已开始 Session 的模型/权限保护和默认 effort 归一化 | 同上；[work-execution.spec.ts](../../tests/work-execution.spec.ts) / [task-runtime.spec.ts](../../tests/task-runtime.spec.ts)，`--phase host` | 继承来源且既有显式用户记录不被改写；不符合启动条件明确拒绝。为跑通重写已开始会话即 FAIL |
| A05 已自动化 | native UUID registry 的 owner 隔离和非消费观察 | [work-execution-official-jobs.integration.ts](../../tests/work-execution-official-jobs.integration.ts)，`--phase jobs` | list/get + Session observation 不调用 read/readAt、不移动 cursor、不激活模型；跨 owner/unowned 不越权 |
| A06 已自动化，P1 `2a6e519` | 首读已消费后 post-execute 抛错、取消或成功 result append 丢失；重复 read 成功但 payload 空 | 同上；[work-execution-official-jobs.spec.ts](../../tests/work-execution-official-jobs.spec.ts)，`--phase jobs` / `unit` | 空重复不能得到 delivered，旧作业仍 pending。仅“successful tool/result 排在 settled 后”即解除门禁为 FAIL |
| A07 已自动化，v2回执 | canonical 有 payload，但 post policy `accept.content=[]` 或任意替换内容；不能给被抹除/替换的真实输出发 receipt | 同上；[official-job-receipts.ts](../../src/work-execution/official-job-receipts.ts) | 公开纯 `output.render` 的完整 canonical 投影必须与最终提交内容一致；清空/无关替换均 pending，v1回执被拒绝。真实有损 finalizer 也保持 pending，不重复调用有状态finalizer；只算最终任意内容 digest 而 delivered 即 FAIL |
| A08 已自动化 | 正常 terminal read、带 payload 的 running `wait:true`，含默认 inline 策略下提前开始 wait | 官方 jobs fixture，`--phase jobs` | 精确 canonical payload 与真实 direct Session call/result commit 配对才 delivered；无需伪造“settled 必须早于调用” |
| A09 已自动化 | 两个并发 read；一份消费 payload、一份成功空结果 | 同上 | 仅确实交付且提交的一方建立证明；空一方不能补造证明或互相串 receipt |
| A10 已自动化 | no-commit、parent/PTC 子 dispatch、inline 通知、真正空输出/空 final result 的边界 | 同上 | 无 direct commit/无 payload 保守 pending；inline prose 不能冒充身份。PTC 仅覆盖公共子 dispatch seam，完整 PTC VM 未验证；“这些自动解除”即 FAIL |
| A11 已自动化 | receipt 的 owner/job/call/result/source seq/turn/step/字节数/digest/版本篡改；JSONL flush 后冷读取 | 同上及 official jobs unit | 错配拒绝；合法精确 receipt 冷读恢复。result=unknown、acceptance=unassessed 保持，delivery 不替代业务验收 |
| A12 已自动化，限既有 fixture | V3→V4 journal、UUID registry 重启隔离、旧 fork epoch、公开 remove 后 loss | 官方 jobs fixture；[work-execution-lost-job.spec.ts](../../tests/work-execution-lost-job.spec.ts)，`--phase jobs` / `unit` | live blocker 不因补跑新作业自动消失；官方终态记录被操作者明确移除或旧 registry 结束后，才按 lost/unknown 给提醒，不伪造 delivered。不代表任意 live migration 全覆盖 |
| A13 已自动化 | 普通 unit、旧 Host、Node、类型、构建、仓库不变量 | 上述 full 阶段 | 全部选中阶段 exit 0；任何真实失败须处理，不用 skip/软断言/增加超时代替定位。unit markerless 的无 `.git` 临时根是环境前提 |

## P：机器运维准备矩阵（不由 runner 执行）

本机已有私有 `official-profile-preparation` 工具及其 README，位置由父会话私有证据索引提供。以下命令中的 `$PREP` 指该目录，`$STAGE` 指新生成的 staging，`$FINAL_PACKAGE` 指已构建的最终 A2D2 包目录。禁止用尚未构建的源码树或旧已部署包冒充最终包。不要把机器真实路径、token、用户会话复制到此文档。

```bash
# 仅在已审计的私有准备目录运行，不启动 Host、不改 live。
/ABS/NODE/bin/node "$PREP/prepare.mjs" prepare \
  --name UNIQUE --a2d2-package "$FINAL_PACKAGE"
/ABS/NODE/bin/node "$PREP/prepare.mjs" check --stage "$STAGE"
python3 "$PREP/emit-install-plan.py" "$STAGE"
```

P04–P07 的私有运维工具位于父维护的 `official-dsh-upgrade-ops`；用 `$OPS` 表示其目录。以下是现有确切入口，runner 不执行它们。`--audit-live-copy` 会复制大量数据且不是静止快照，是否运行由父的运维范围决定，不能把 audit 回执用于激活门。

```bash
python3 -B "$OPS/switcher.py" inspect
python3 -B "$OPS/switcher.py" inventory
python3 -B "$OPS/rollback_reader.py" --audit-live-copy
# 正式 reader 仅接受计划固定的 final/postfailure 路径与对应阶段。
python3 -B "$OPS/rollback_reader.py" --snapshot "$FIXED_FINAL_SNAPSHOT" \
  --stage prestart --plan "$PRIVATE_BACKUP_PLAN"
python3 -B "$OPS/rollback_reader.py" --snapshot "$FIXED_POSTFAILURE_SNAPSHOT" \
  --stage postfailure --plan "$PRIVATE_BACKUP_PLAN"
# 在 OPS 工作目录执行工具自身的拒绝/真实 reader 回归。
python3 -B -m unittest -v test_guards test_reader
```

prepare/check/emit 只作 P01/P02/P03 的既有入口；P04–P07 还必须由父运维计划逐项完成并留原始证据，不能凭 emit 成功跳过。运维完整候选清单包含全部源码、依赖、lib/dist/native、权限和链接；它比 quick 的构建指纹范围更广，仍须单独冻结并复核。

| ID / 类别 | 步骤与证据 | PASS / FAIL 定义 |
| --- | --- | --- |
| P01 纯官方 profile 来源 | 对全部直接产品、共享 modules、外链产品及所有 runtime resolution 行做来源审计；冻结最终包、manifest、链接与实际导出路径；使用上述 prepare/check/emit | 核心包都来自同一精确官方候选，实际解析表不泄漏祖先旧 node_modules。仅扫描 profile 根的几个链接不够；退役 peer 要有原声明/快照/引用审计，不能改真实产品代码掩盖问题 |
| P02 配置与兼容 metadata | 私有副本中保留用户设置、`!!js` 表达式及 bundle 选择，替换正式包入口；运行官方和旧 Node/CLI 的 dump，保留 exit/diagnostics 和摘要 | 无 compatibility exemption；最终包 metadata 真正接受 rc.3；旧路径覆盖已清点。dump 可能写配置，绝不能指向 live DSH_HOME；解析成功不等于功能验收 |
| P03 官方 default schema 上游缺陷 | 独立纯官方默认 profile 与候选 profile 分别执行 `--dump-config-schema`，保留原生 exit、complete、全部诊断，动态比较差异 | 当前默认本身有四个 preset tree-carrier 错误。候选无新增 schema 错误可记“相对基线未恶化”，但上游 exit 1 仍原样记录；硬编码四项、改成 exit 0 或伪造 complete/pass 均 FAIL |
| P04 凭据、签名与 Cookie | 只读清点登录/签名 key、provider 凭据、Cookie 关联配置和原服务环境引用；证据仅保存权限受控的 hash/数量/引用，不公开值 | 准备阶段原始字节和权限不变；原签名 key 不轮换、不要求重新生成身份。原 HTTP backend 的离线跨版 Cookie 验签不等于原 GUI 登录通过；原生 TLS 的旧 host 与官方 https origin authority 差异也不能据此宣称互认。GUI 仍需 G01 验证原 Cookie；快照含敏感内容必须私有 |
| P05 全 home / DAO / archive / sidecar 闭包 | 服务外先识别全部写者；停写后对完整 DSH_HOME 及外置 DAO/archive/source/storage/索引/元数据/sidecar 建 checkpoint，冻结清单与 hash。在隔离副本读取并比较 baseline：会话 id/计数、事件序列、归档、来源/附件引用和 DAO 记录差异 | 所有被引用对象都在归档闭包或有明确外链保留方案；迁移前后差异逐项解释。只有 profile 备份/若干 session 抽样/仅比较总数量为 FAIL；未知 reader 报错不能当“无数据” |
| P06 旧 reader 回退边界 | 在升级后数据的完整隔离副本上，用精确旧 Node/Host reader 验证 `job/registered`、`job/settled`、`working-directory/change` 等旧版未知记录；比较原 baseline 与迁移后差异、降级诊断和是否丢失语义 | 按真实格式/catalog 判定可忽略或不可读，不能手改日志让其通过。本次私有副本审计已见旧 reader 在候选写入前就拒绝部分 v4 必需词汇（含 job/registered、working-directory/change）；后续 job/settled 也必须纳入词汇边界检查，不能因前一事件先失败而漏测。先比较 baseline，不能把既存拒绝归为候选新损坏。能 dump 配置不代表能读新会话；只 bootstrap persistence adapters 也不证明完整 profile/其他 settings、storages、插件迁移，现有未覆盖门必须保留。未知/不可读记 needs-recovery，禁止直接启动旧 Host 写 live；本集不承诺所有 live migrations 可回退 |
| P07 服务外切换/回退计划 | 固定 supervisor 同一服务、原 Node/cwd/CLI/env/参数、所有写者和执行责任；复核 checkpoint 与候选 hash 后由服务外执行者操作 | 不在即将被停的 Host 内承担切换；保留原 home、原端口、原用户入口。失败先停新写者并保留完整 postfailure 副本，验证旧 reader 后才恢复旧 Host；禁止用旧 checkpoint 覆盖新增用户输入 |

## G：必须实际 GUI 的矩阵

验收使用升级前已实际核实、用户正在使用的原 GUI 入口，同时记录真实监听和代理路径。内部健康检查地址与用户对外入口分别核实，不能从约定 IP 推定某端口可达。本子任务不启动或切换服务。父应记录实际候选 SHA/profile 哈希、时间、原 URL、操作步骤、可见结果与私有截图索引。

| ID | 实际操作 | PASS / FAIL 定义 |
| --- | --- | --- |
| G01 原登录与 Cookie | 切换后在原浏览器原入口刷新，检查现有登录/签名会话；不得通过清 Cookie/新 home/重建用户来制造通过 | 原身份保持；需要意外重新授权、身份变更、签名失败必须记录为失败并定位 |
| G02 旧会话与完整数据 | 打开既有普通/归档会话、项目/工作目录、DAO/source/archive 引用，核对 P05 baseline，再创建受控新会话 | 原记录可读且含义不丢；新增事件可正常提交。只看首页加载或新空会话不能通过 |
| G03 模型/权限/preset | 在受控会话实际选择模型/effort、检查其他会话和全局默认，验证既有会话权限及 preset | 当前会话正确、全局不污染、权限不静默降级、UI 与持久化一致 |
| G04 产品插件与作业/A2D2 | 验证当前启用的全部直接产品及侧栏、浏览器、连接器和 A2D2；执行可控带输出 job，观察/收取/重读/完成门禁 | 真实 UI/工具事件与 A 场景语义一致。空结果/inline/PTC/丢 receipt 保守边界须如实呈现，不能以“新建一个 job”抹除旧 blocker |
| G05 回退预案 | 仅按父授权计划，在保留新输入的前提下执行需要的恢复并复验原 GUI | 数据完整、旧 reader 已在副本证实可读、原登录和原功能可用；若未执行回退实操，只能记“计划准备完成/回退实机未验证” |

## 本次发现台账

下列数据结果来自私有审计副本，属于升级前准备；不表示生产数据已经迁移或服务已经切换。

| 发现 | 已核实结果与后续验收要求 |
| --- | --- |
| 同版分发不同 API | npm rc.3 缺会话本地模型选择，官方固定源码构建具备；测试绑定提交和实际产物，不以版本号替代 |
| 两个作业收取 P1 | 消费后失败再空读、canonical 与 presentation 分离均有真实红灯及修复后绿灯；固定在 A06/A07 |
| 历史 V0 格式 | 旧、新 reader 共同拒绝629个 V0，其中615明确为不支持的 descriptor 版本；保留原始代文件，不能删除、手改或作为候选新增损坏统计 |
| 旧 V4 词汇 | 旧 reader 在候选运行前已拒绝264个 V4：`job/registered` 226、`working-directory/change` 38；候选可读这264个。未来 `job/settled` 等新增必需类型仍要单独验证回退边界 |
| 真实写迁移与 DAO | 副本实际生成193个新 V4，旧 reader 可读这些新增文件；DAO旧→新→旧逻辑摘要一致，10 tasks/146 commands/10 executions/3 sources，9909个archive/sidecar JSON通过。未引用旧blob只有语法证明，不冒称完整语义验收 |
| 活跃复制引用竞态 | 首轮 live-copy 控制快照缺2个根引用，仅向副本补135个可达不可变blob后闭包读通。正式验收仍需停写一致性快照，不能用活跃copy当checkpoint |
| 真实 reader 身份 | 共享 modules 的链接目标不能代表运行服务的正式reader；实际启动解析器与磁盘编译hash对上后才固定旧适配器。未取得内存module cache的限制须明示 |
| 配置漂移 | 调查期间 live profile patch 有外部变化；最终候选必须重新保存实际控制配置并核验前后hash，不能用早期snapshot覆盖后来的设置 |
| 官方 schema 基线 | 纯默认profile本身有4个preset诊断，保留原生exit1，候选只比较新增诊断；不能把它写成schema全通过 |
| Cookie audience | 原HTTP backend跨版兼容，原生TLS的旧host/new https-origin不互认；Caddy终止TLS后的backend按HTTP路径验签。原浏览器仍必须G01实测 |
| 隔离测试的 native 解析 | 第一轮统一入口发现fixture依赖隐式resolver、缺native flock映射；现显式取候选native包，清除父Host注入后仍通过 |

## 执行记录与以后升级的最短路径

2026-10-24 自验候选：完整 SHA `22ddee3792402c3e70ec5f86a63c3e3e895a2f60`、版本 `0.2.1-rc.3`，成功运行使用 Node `v24.22.1`。下列运行标识对应执行者交给父会话的私有报告索引，未提交原始日志或绝对机器路径。

| 检查 | 实际记录 |
| --- | --- |
| 新 runner 单文件 unit | 5/5 通过，exit 0；错误 SHA、dirty、Node engines、缺构建、非法阶段均拒绝，候选/live sentinel 不变且服务/install trap 未调用 |
| 真实候选 Node22 预检 | Node `v22.23.1` 因候选 `>=24.9.0` 被拒，exit 1，未创建报告目录；属于预期拒绝 |
| 首次 quick | 运行标识 `upgrade-runner-quick-20261024-a`：Session 导入因配置未映射官方 native flock 包失败，0 tests，exit 1，jobs 未执行；保留真实失败，交父修配置 |
| 配置修正后 quick | 运行标识 `upgrade-runner-quick-20261024-b`：Session 4/4、jobs 1/1 完整集成场景通过，阶段 exit 均 0，耗时分别 7354ms / 2766ms；结束 SHA/clean/build/源码冻结复核通过 |
| 构建记录与私有权限 | 实物重算官方客户端 358 个产物，符合官方记录；quick-b 构建摘要 `8713b09a6d2204b6bf0704dd667ba2e46cc064d59b89956b5b8a6b117f88cc0a`。报告目录 0700、JSON/两份日志 0600；另一次真实预检拒绝覆盖已有报告 |
| 单阶段与仓库不变量 | 运行标识 `upgrade-runner-repository-20261024-a`：`--phase repository` exit 0，113ms，结束冻结复核通过，未隐含 build |
| 其余范围 | 本子任务没有重复 full、typecheck 或 build，没有运行 profile 安装/数据 reader/服务切换/原 GUI 验收；父统一检查最终整合源码 |
| 父补测 A07 | 真实官方清空/无关替换展示先红后绿；v2 projection检查与有损finalizer场景通过。6文件63项相关回归通过，类型检查和正式构建通过 |
| 父统一 quick 复核 | 运行标识 `upgrade-parent-quick-20261024-final`：session 4/4、jobs 1完整场景通过，两个阶段约10秒，结束构建/源码冻结复核通过 |

以上证据绑定各自报告的插件源码摘要。文档补记不能替代最终发行包验证。父在第二个P1投影修复前运行的全套为109文件1246项通过，Node suites为28通过/2个既有可选项skip；投影修复后按影响范围补测，不能把旧全套结果称为最终源码全套已跑。

以后升级按此顺序：冻结候选 → quick → 仅重跑失败项 → 最终源码按需 full（build 一次）→ P 的最终包/profile/数据基线 → 服务外切换 → 原 GUI 验收。不能把一次 quick、纯官方 schema 对照或配置 dump 的通过改写为“所有 live 数据迁移、空输出自动恢复和完整升级均支持”。
