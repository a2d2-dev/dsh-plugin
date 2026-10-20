# #122 执行测试超时与 fixture 清理竞态诊断

## 背景

诊断基线为 `2d0beb9f6dfeb7757315dc86614f0ea26bc3e4f0`。CEO 原四文件组合在真实 Controller 回执丢失用例中得到 `Test timed out in 5000ms`，显示 7007ms，随后 `afterEach` 删除 `work` 目录报 `ENOTEMPTY`；20/21 通过，退出 1。

**原始超时首因仍未知。已定位并修复的是测试超时后的二次清理竞态。** Vitest 的超时结束等待并取消测试信号，不会强行终止原 async 函数。原 fixture 只登记 Context 和目录；独立的 `WorkApplication.execute` 仍可能在宿主出错后继续保存回执。Context 提前拆除会干扰尚在执行的 Controller；`catch/save` 又可能在递归删除期间创建锁和临时文件。历史人工延迟 trace 明确观察到这条链，但不能证明 CEO 当时真的发生了同样的 fsync 延迟。

旧 actor 问题已在基线修复，不属于本次诊断。直接 `node` 测试不经过包管理器预运行；安装提示不能作为这次超时的解释。

## 目标

- 关闭后不再接收应用调用或挂载恢复阶段，也不把取消前的结果返回给原测试 continuation 继续执行。
- 已接受的调用先结算；Context dispose 和目录删除排在它们之后。
- 在清理预算内不能结算时，保留 Context 与目录，错误中明确给出保留位置。

### 非目标

本分支不改变生产取消契约、持久化逻辑、原 5000ms 测试预算、既有断言含义或测试配置；不声称修复 I/O 性能或 CEO 原始超时。

## 架构

### 概要设计

每项执行测试在 `beforeEach` 创建一个 `ExecutionFixtures(signal)`，在 `afterEach` 调用 `close()`。所有应用实例（包括竞争启动与重放实例）、挂载、显式 dispose 和直接宿主等待均进入同一个测试拥有者。真实 Controller、SessionPersistence、WorkApplication 和文件系统仍照常执行。

### 架构设计

[fixture 拥有者](../../tests/work-execution-fixture.ts) 的 `run` 在调用前、排队开始时和真实 Promise 结算后检查关闭/取消状态。它保存真实调用的 Promise；取消后等待该调用完成，但不向原测试 continuation 返回结果。这样不会取消已接受写入，也不会继续启动恢复挂载。

`mount` 在 Context 构造后、第一次异步插件装配前登记它，覆盖装配途中超时的情况。`application` 包装真实实例的公开 `execute/query`；[原执行测试](../../tests/work-execution.spec.ts) 通过该工厂创建额外实例，通过 `run` 跟踪直接宿主调用。

`close` 立即关闭入口，再等待全部在途 Promise 结算，之后按逆序 dispose Context，核验所拥有目录的绝对路径、父目录、前缀与 realpath 后才删除。默认 **5000ms 清理结算预算** 与原测试的 5000ms 截止分别生效；前者不延长原测试。预算耗尽会报 `Execution fixture work did not settle; retained: …`，不进入 dispose/rm，也没有自动重试。保留现场回归在释放栅栏后显式再次关闭，验证最终能完成清理。

### 组件模块

| 组件 | 职责与状态归属 |
| --- | --- |
| `ExecutionFixtures` | 拥有测试的目录、Context、在途 Promise 与关闭状态 |
| `WorkApplication` | 仍负责真实工作记录和错误回执；生产代码未改 |
| 公开 Controller / SessionPersistence | 仍执行真实装配、flush、关闭与持久化 |
| [生命周期回归](../../tests/work-execution-lifecycle.spec.ts) | 通过真实调用、可释放栅栏、公开查询和目录状态验证顺序 |

### 数据流程

测试命令 → 拥有者登记真实调用 → WorkApplication / Controller 持久化 → 真实调用结算 → 取消门禁阻止下一阶段 → Context dispose → 目录核验与删除。无法结算的分支停在等待处并报告保留目录。

## 场景

### 接入与原有执行断言

在本仓库根目录使用锁定依赖。本分支独立执行 `pnpm install --frozen-lockfile --ignore-scripts`，退出 0；没有复用或修改另一 checkout 的依赖。Node 22.23.1、Vitest 4.1.11。

```sh
node node_modules/vitest/vitest.mjs run tests/work-execution.spec.ts tests/work-execution-lifecycle.spec.ts --configLoader runner --no-cache
node node_modules/typescript/bin/tsc --noEmit
```

实际结果：8/8 通过、0 未选、退出 0；backend 无写类型检查退出 0。原执行断言保留，仅将等待阶段纳入拥有者。

### 取消一个真实 Controller 回执丢失调用

聚焦回归先执行真实 `Controller.create` 与 `sessions.flush`，然后用 Promise 栅栏暂停回执。取消并关闭 fixture，验证新命令被拒绝、目录仍存在；释放栅栏后，在 Context disposal 的公开 effect 中查询到已保存的 `failed/host-create-unknown` 回执，确认原调用先结算。恢复挂载没有启动，最终目录不存在。没有伪造宿主成功结果，也没有长 sleep。

同一命令的红阶段得到 1 失败、退出 1：关闭后的 `project.create` 仍返回 `completed`；绿阶段得到 1 通过、退出 0。另一回归使用已提交真实工作后的栅栏与零清理预算，验证明确保留目录、宿主服务仍可观察、关闭后新命令被拒绝；释放后才成功清理。

### 原组合与超时负向复验

```sh
node node_modules/vitest/vitest.mjs run tests/work.spec.ts tests/work-execution.spec.ts tests/work-host.spec.ts tests/work-process.spec.ts
```

本分支唯一一次原组合得到 **20 通过、1 失败，退出 1**：header 回执恢复项显示 5578ms，唯一错误为原 `timeout5000`；controller 项通过（1554ms）。这是新的自然 header 超时，不能称为 CEO 历史 controller 失败的复现。退出后自有 fixture 剩余目录数为 0，没有 ENOTEMPTY。没有重跑追绿。

另外仅做一次负向实验：临时运行时 preload 在首次 append-mode session 文件的真实 `FileHandle.sync` 前加入一次 4400ms 延迟，原 5 秒与断言不变。controller 单跑得到 **1 失败、5 未选，退出 1，7027ms**；唯一错误仍是原 timeout。没有服务拆除错误、ENOTEMPTY 或删除后写入；实际目录全部删除。这是清理顺序的负向验证，不是产品恢复成功或历史 fsync 原因的证明。

该 trace 的 worker 单调时钟顺序为：7733.963ms 最后写入/rename 完成，7734.416ms execution 锁释放，7754.799ms session 写租约关闭，7755.803ms 根目录删除开始，7757.463ms 删除成功；删除开始后写入事件 0、文件系统错误 0。原超时仍在，二次竞态不再出现。

## 证据与未解决项

[最小脱敏证据](evidence/a2d2-v3-122-fixture-cleanup.json) 分列命令、退出、通过/失败/未选及负向时序。原始 stdout 与 preload/trace 保留在本地 `/tmp/a2d2-122-cleanup-1gsrixn1`，不把随机工作身份或宿主路径提交入库。

历史诊断的自然样本须继续分环境记账：`/tmp`（device 64768）4 单跑/4 组合，共 88 通过、20 未选；`/data`（device 64769）1 组合 21 通过。它们均不能定位 CEO 首因。历史人工延迟产生 timeout+ENOTEMPTY；本分支人工延迟只剩 timeout。自然 header 超时与两个环境的绿样本共同说明性能首因仍需失败当时的独立证据，本分支止于 fixture 生命周期修复。
