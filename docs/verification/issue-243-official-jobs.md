# #243 官方 DSH jobs 观察适配验证

## 目的与范围

在纯官方 DSH `0.2.1-rc.3` 上恢复 A²D² 的后台作业观察与完成门禁，同时保留旧 fork journal 的历史读取。插件只使用公开 `jobs.list/get` 和 `sessionQuery.observeSession`；观察不读取输出、不改变模型 cursor，也不激活模型。

- 插件工作树：`/data/src/github.com/a2d2-dev/dsh-plugin/.scratch/official-dsh-jobs`；分支 `fix/243-official-jobs`。
- 插件 base：`acaaece04a6a1494e5c6633c1b9c7d2a2ec35149`。
- 只读官方源码与构建：`/data/src/github.com/deepseek-ai/deepseek-harness-dev.worktrees/dsh-upgrade-latest-20261024`；HEAD `22ddee3792402c3e70ec5f86a63c3e3e895a2f60`。
- 命令显式使用 Node `v24.22.1`，`TMPDIR=$PWD/.local/tmp`。未修改 Host 源码、profile/live 数据、原 Session 文件，也未启动服务、浏览器或真实模型。集成 fixture 的 Session/JSONL 全在该 TMPDIR 下新建，并只通过官方公开服务读写和冷观察。
- 未安装依赖、未修改依赖包。**执行偏差：前几次默认 Vitest 自动更新了共享依赖目录中的 `.vite/vitest/.../results.json` 测试缓存，已报告父会话。未尝试清理或回写该共享目录；后续改用 `--configLoader runner --cache=false`，集成配置的 `cacheDir` 固定为本工作树 `.local/tmp/vite-official-jobs`。最后一次集成运行前后该共享缓存 mtime 不变。**

生产变更仅涉及 [job-observation.ts](../../src/work-execution/job-observation.ts)、[official-job-observation.ts](../../src/work-execution/official-job-observation.ts)、[host.ts](../../src/task-runtime/host.ts)。未修改另一 writer 负责的入口、root-session 或 dsh-host。

## 公开合同与采用的证明

官方 [jobs 类型](../../../../../../deepseek-ai/deepseek-harness-dev.worktrees/dsh-upgrade-latest-20261024/packages/jobs/jobs/src/types.ts) 定义 `job/registered`、`job/settled`，携带原 owner、唯一作业标识、kind、label 与生命周期事实；[registry](../../../../../../deepseek-ai/deepseek-harness-dev.worktrees/dsh-upgrade-latest-20261024/packages/jobs/jobs/src/index.ts) 的 `get` 不消费，`list` 含当前 owner 和 unowned。适配再做 exact owner 过滤，用 `get(id, owner)` 核验 live 身份，并验证官方 `kind-<16 UUID hex>` 身份域。旧 ordinal / list-only Host 保持 unavailable。官方行不产生 registryEpoch 或 instanceId。

官方 [job_output 实现](../../../../../../deepseek-ai/deepseek-harness-dev.worktrees/dsh-upgrade-latest-20261024/packages/jobs/tool-jobs/src/index.ts) 在成功路径执行真实 `jobs.read`；canonical `{ text, job }` 不随标准 Session 日志持久化，也没有默认收取 receipt。本实现采用授权的保守路径：

1. 从本会话非 inherited 的公开日志读取同 owner、同官方 JobId 的 `job/settled`。
2. 仅当该 settled 的 seq 严格早于 direct `job_output` 的 `tool/call`，且 JSON arguments 的 `job_id` 精确匹配，才建立候选。
3. 仅当同 callId、turn、step 的后继 `tool/result` 明确成功，且无 error，才投影 `delivery=delivered`。
4. 所有官方行始终保持 `result=unknown`、`acceptance=unassessed`。交付不能代替模型理解或业务验收。

不解析输出或 summary，不修改 readonly canonical result，不添加 PostToolDecision 不支持的 meta，不使用宿主私有 registry 状态，不调用 `read/readAt` 观察。

旧 `jobs/*` 保留 epoch/instance 身份；官方 V3→V4 对未知 ignorable 事件改名为 `plugin:jobs/*`，这些迁移后的事件也可读。官方唯一 JobId 与旧 fork 身份使用分离的 Map key，避免跨域误配。

## 恢复行为与实际限制

- running→terminal 且无交付证据的 reachable 作业仍阻断。detail 明确要求终态后再次 direct `job_output`，成功提交结果后解除等待。
- 如果 `job/settled` 晚于调用开始，即使它早于 `tool/result`，也不能证明该次 read 已经读取终态；running 开始的 wait 同样保守保留 pending。终态后的重复读取可恢复。
- 丢失或失败的 tool result 不会记录假交付；成功重复读取可恢复。重启后可由已持久化的三个事件重新建立证明，不依赖内存 receipt 或侧车。
- inline completion 通知、job_kill、teardown、移除 foreground 作业均不构成收取证明。无证明且 registry 已 lost 的旧作业仅给 bounded reminder，不永久阻断，也不提示执行不可行的重复读取。
- 本实现不证明 PTC 内部读取，也不承诺一次 running wait 立即解锁；可恢复操作是终态后 direct `job_output`。
- 若官方 registry 因日志 append 失败而根本未记录 `job/settled`，此保守路径没有持久 read-time 身份/状态证明。它不会伪造交付；仅重复读取无法补造缺失生命周期事实。要覆盖该故障，需要额外的 canonical result + 对应已提交 Session result 的插件持久 receipt，或官方提供原生持久 read-time receipt；本片未实现、更未声称具备该能力。

## 步骤与命令记录

所有测试从上述插件工作树运行。范围回归沿用既有 fixture 和不可变依赖；官方正向验证则显式加载指定官方构建。

```bash
export PATH=/root/.nvm/versions/node/v24.22.1/bin:$PATH
export TMPDIR="$PWD/.local/tmp"
node node_modules/vitest/vitest.mjs run --configLoader runner --cache=false \
  tests/work-execution-official-jobs.spec.ts \
  tests/work-execution-jobs.spec.ts \
  tests/work-execution-lost-job.spec.ts \
  tests/work-execution-observation.spec.ts \
  tests/work-compact-results.spec.ts \
  tests/work-execution-boundary.spec.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
DSH_OFFICIAL_HOST_ROOT=/data/src/github.com/deepseek-ai/deepseek-harness-dev.worktrees/dsh-upgrade-latest-20261024 \
  node node_modules/vitest/vitest.mjs run --configLoader runner --cache=false \
  --config tests/official-jobs.config.ts
git diff --check
```

范围回归的已完成 46 项运行使用的是相同测试列表的默认 config loader/cache 命令；上面展示后续应使用的无共享缓存等价命令，不把未执行的变体冒称已执行。

| 记录 | exit | 结果 |
| --- | ---: | --- |
| 第一片 red：仅增加官方 get/list 观察测试 | 1 | 复现 capability 从 unavailable 无法变 available |
| 第一片 green：官方观察 + 旧 fork 身份 | 0 | 2 文件、2 测试通过；commit `a8fdb4f` |
| 第二片 red：成功终态 job_output 后观察 | 1 | 复现 delivery 仍为 pending |
| 第二片 green 与扩展回归 | 0 | 3 文件、31 测试通过；commit `a340abb` |
| 迁移兼容 red | 1 | `plugin:jobs/settled` 未被读取 |
| 不可达恢复提示 red | 1 | lost 行错误提示再次 job_output；随后限制为仅 live 行提示 |
| 范围回归最终运行 | 0 | 6 文件、46 测试通过 |
| 服务端 TypeScript 检查 | 0 | `tsc --noEmit --incremental false` 通过 |
| 官方 fixture 初次装配 | 1 | 官方 JSONL 已改为 namespace 插件，default 为 undefined；按实际源码修正 |
| fixture 初次类型检查 | 2 | 项目 ES2023 类型无 Promise.withResolvers；改为标准 Promise 门闩 |
| 官方 built fixture（含真实 V3→V4 迁移） | 0 | 1 文件、1 完整集成场景通过 |

## 覆盖证据

[公开观察回归](../../tests/work-execution-official-jobs.spec.ts) 共 19 测试，覆盖官方非消费 get/list、unowned/foreign 隔离、get 身份变化拒绝、UUID 重启身份、旧/新 journal 共存、迁移后旧 journal、running→terminal 未收取阻断、成功终态读取解锁、read/result 间竞态、丢回执/失败/重复读取、registry lost 仅提醒、通知文本无证明、观察无激活。既有 [lost-job 门禁测试](../../tests/work-execution-lost-job.spec.ts)、[fork 身份测试](../../tests/work-execution-jobs.spec.ts)、[执行边界](../../tests/work-execution-boundary.spec.ts)、[观察图](../../tests/work-execution-observation.spec.ts)、[紧凑结果](../../tests/work-compact-results.spec.ts) 一并通过。

[官方集成 fixture](../../tests/work-execution-official-jobs.integration.ts) 通过[显式配置](../../tests/official-jobs.config.ts)运行：缺 env、官方 SHA 不符、模块非 rc.3 或构建缺失会 hard fail，不 skip。它使用真官方 registry、tool-jobs、AgentLoop、Session、JSONL、sessionQuery 与 format catalog；只有模型是确定性脚本适配器，无外部模型请求。验证内容包含：

- Host 没有 fork `jobs.observe` / `appendIgnorable`。
- 真 registry 的 owner 拒绝与 list 中 unowned 过滤。
- 连续观察不调用 `read/readAt`，不增加模型请求；显式读取仍取得完整 stream 和 terminal result。
- 终态前 wait 的成功结果保持 pending，后续 direct terminal repeat 解锁。
- 真 Session result 和生命周期事件 flush 后可从新 Context 冷读重建 delivered；未收取历史仅提醒。
- 新 registry 生成新 UUID；官方真实 V3→V4 catalog 迁移的 legacy journal 由 RuntimeHost 正确读取。

未运行全仓测试、浏览器/UI 验收、live 模型或父分支合并后的统一测试。旧 fork 专用 matched-host 集成不是本片的官方验证入口。未创建 PR、未 merge、未关闭 Issue；父会话负责合并两片并统一 review。
