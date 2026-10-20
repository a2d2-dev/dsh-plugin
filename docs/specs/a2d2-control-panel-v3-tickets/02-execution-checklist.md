# 第02票实施与验收接续记录

本记录承接 [#122](https://github.com/a2d2-dev/dsh-plugin/issues/122)，父任务为 [#120](https://github.com/a2d2-dev/dsh-plugin/issues/120)。[原票规格](02-start-and-coordinate.md)的11条验收不变；本记录组织证据和实施顺序，不增加范围，也不把阶段提交当整票完成。实际派发与最新状态以Issue正文和结果评论为准。

## 固定基线与已核验范围

- 规格集成基线：`1f562b107ad9adc046b1f0bb01929185b5c7d234`；[PR #130](https://github.com/a2d2-dev/dsh-plugin/pull/130) 已合入 `spec/dsh-control-panel-v3`，不是 `main`。#121已关闭。
- 首个实现检查点：`606fcee`，保存稳定执行预约、Task/Session唯一性检查及执行查询。CEO已核对提交diff，并运行 `pnpm exec vitest run tests/work.spec.ts tests/work-execution.spec.ts`：2文件9项通过、0 skip，`git diff --check`通过。
- 其中新增1条行为测试证明同一Task竞争启动与持久命令重放汇合；它不证明跨进程竞争、两Task抢Session、真实宿主创建、配置装配或恢复均已成立。
- `completed`命令回执只表示该命令事实已保存；`execution.state=accepted`不表示宿主运行、工作完成或验收通过。
- 既有18780/18781服务不在本票部署范围。隔离宿主验证不代表现有GUI已更新。

## 实施顺序与文件所有权

| 阶段 | 当前执行位置 | 交付边界 |
| --- | --- | --- |
| A 启动与控制后端 | `feat/a2d2-v3-02-coordination`；engineer `session-0bf12b17-ffa2-4af6-abb6-b06bfdd8a30f` | 原子预约、真实宿主创建/复用、配置、回执恢复、进展/等待/暂停/恢复及调用者校验 |
| 验收工具准备 | `test/a2d2-v3-02-host-acceptance`；engineer `session-3ee1b56a-2b9d-42b5-b3bc-c150c6ee7490` | 确定性模型正控、真实宿主/浏览器装配及累计计数；产品未就绪时不宣称产品通过 |
| B 手动接续与围栏 | 待A接口提交后派发 | 新TaskRef五步恢复、固定后继/消息、受围栏接任、退休会话失权和历史只读 |
| C 界面与整合 | 待真实命令/查询契约固定后派发 | 开始处理、当前会话/状态、等待控制、历史只读、原生新旧入口和浏览器操作 |
| D 评审与交付 | 最终固定base/HEAD后派一次fresh review | 安全/正确性和原票契约；修复后CEO按清单复核，不以重复评审扩大范围 |

当前实际dispatch回执为 `codex/gpt-6.1-sol/medium`；最终评审使用reviewer档位并核对实际回执。跨阶段有未完成项时保持Issue Open。各写任务使用独立worktree。

## 逐条验收证据索引

“待验证”不能因相邻行或单个单元测试通过而自动变为通过。

| AC | 可观察完成事实 | 当前证据/待补 |
| --- | --- | --- |
| 1 单意图与分步事实 | 接受、创建、运行、失败分别可查询；重试不把预约当运行 | 606fcee只证明预约；实际宿主状态待补 |
| 2 执行环境 | ExecutionId、Agent、owner/epoch、实际runtime/cwd、preset与有效权限可核实 | 已有请求字段；实际装配与快照待补 |
| 3 双向唯一性 | 同Task竞争、两Task抢Session、重复点击/重试无第二owner | 同Task应用实例竞争已覆盖；其他竞争与真实宿主计数待补 |
| 4 公开宿主接口 | 公开创建链装配资源/preset；局部模型请求/提示词/观察一致，全局默认不变 | 接口源码已核实；真实组合测试待补 |
| 5 创建回执未知 | 宿主创建成功后丢回执，恢复同一执行/会话，不再次创建 | 待真实故障窗口；收到回执后杀writer不能替代 |
| 6 控制与消息 | TaskId进展、提问/等待、暂停/恢复可调用，actor/epoch校验，等待不空推 | 命令/工具及接受、投递、消费分别可观察待补 |
| 7 关联与历史 | related/review不自动抢身份；历史不激活Agent、不改current | 普通follow会promote已核实，专用只读投影待实现 |
| 8 接续恢复 | 五步中断后恢复同一操作、后继及完整消息身份 | 旧流程可复用；新TaskRef端口/恢复证据待补 |
| 9 接任后入口 | 有效take才更新current；原生新旧会话回同Task；状态一致 | 接任、反向关联及真实浏览器证据待补 |
| 10 旧权威 | 未迁移的旧活动保持旧writer/runner，新入口不重复接管 | 预约有保守legacy映射拒绝；真实旧活动及绕过路径待补 |
| 11 组合验证 | 真实记录/loop/persistence/preset＋确定性模型；浏览器进入真实current | 验收工具准备中；产品证据待最终包 |

## 已核对的接缝及限制

旧[运行器](../../../src/task-runtime/runner.ts)五步交接使用维护边界，先保存完整continuation再take，复用固定后继和消息ID；[宿主适配](../../../src/task-runtime/host.ts)通过日志/inbox区分consumed、queued、missing。新实现将权威读与受围栏接任接到TaskRef/ExecutionId/epoch端口，保留legacy适配。不能删除旧issue约束，也不能复制不共享恢复语义的运行器。

两项保障分别证明：

1. 历史使用经服务端TaskRef/SessionRef关系和runtime/workspace校验的只读投影。普通openSession/follow不是只读，真实宿主冷历史follow会promote Agent。
2. 退休会话收到原生输入、持久inbox或维护期间排队输入时不能驱动原Task。base服务拥有pre-step围栏，在模型/工具执行前拒绝；提交锁内再验caller、ExecutionId、owner/epoch，拒绝已进入step的迟到写入。允许blocked turn记录，但相关模型请求与工具副作用为零。

维护边界释放后排队输入会继续驱动，因此take须在边界内持久提交current/retired/epoch；隐藏按钮、清队列或whenIdle不是围栏。历史接口不能接受任意浏览器SessionId读取其他项目。

## 宿主能力证据分层

DSH源码 `a45068d2ec03326c800c68c9bdcd47508e3ccb9c` 的controller具有selectLocalModel，但源码能力不等于锁包或当前GUI能力。

锁定controller `0.2.0-rc.2` 的selectModel会保存全局默认；旧测试人为补方法不用于本票真实证据。原基线 `@deepseek-ai/dsh-agent` 主导出提供公开installModelSelection，CEO核对声明和实现：在Agent作用域绑定assembly/request，不调用全局默认保存。继续使用原基线公开固定ID create和局部模型接口；候选0.2.1调查没有证明所需语义，不作为升级/验收依据。

仍需实证：模型目录/effort验证、controller既有监听器组合后request和提示词一致、观察模型准确、重载幂等、全局默认持久值不变。创建/接续使用公开controller/preset链；低层SessionStore.prepare不是Controller.prepare，不能绕preset裸造Agent后冒称配置正确。

## 故障窗口与浏览器观察

- 创建已成功但调用者未知时保持固定执行/会话身份。
- take已提交但运行记录未保存时识别既有后继继续投递，不再创建后继。
- 消息入队或消费而回执未保存时按完整消息身份及日志回读去重，不只比较文本。
- 维护期间普通输入、退休冷会话pending消息、调度器卸载后输入仍受执行围栏约束。
- 历史拒绝跨项目/未关联Session；合法读取不激活Agent、不改变current。
- 浏览器从详情进入current，再从新旧原生入口回同一Task；保留项目/列表位置。

不清空累计模型指标或重写基线。确定性模型正控证明adapter实际可调用；按显式操作记录允许增量，历史/退休路径要求零增量，不套用第01票“所有操作总计零调用”的不同前提。记录真实解析包版本、构建/插件/guard指纹、origin、managed job与退出；同实例重启复用原origin。失败、skip、装配错误分别保留。

## 接续规则

LF要求主/子会话在200K前切换。在阶段结束或接近阈值时保存：Issue状态、分支/worktree、提交与未提交改动、验证命令/退出/证据、运行中委派与自有jobs、明确下一步。以本记录及Issue为入口，不复制完整对话；不把新会话/文档落盘当作交付。本票完成后，整体v3仍沿父任务原生依赖继续。
