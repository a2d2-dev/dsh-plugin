# v4 持续委托架构

## 背景

#140 沿用 ADR0011 的 Task owner/epoch、规则串行槽位与持久来源队列。原实现仅按来源发现顺序处理，并跳过已有 execution；自然语言委托需要独立的预览决定与明确启用。

## 目标

保存原话、自然语言补充、稳定 Issue node ID Block、版本计划和完整来源依据。模型仅提出候选，服务端重新验证身份、收录、负责人、执行方式和原生子项覆盖。

### 非目标

不新增调度器，不拓宽资源、权限或网络，不编辑原面板，不实现来源 A 的 Repo/views 组合，不实现 D 的完成事务。

## 架构

### 概要设计

操作人先通过 `continuous.configure` 授权既有执行资源与策略，以 `continuous.instruct` 保存原话或补充，再显式调用 `continuous.preview`。预览经公开 `ctx.llm.stream`，只装配本来源完整 Project snapshot、Issue 正文与原生关系、canonical Task 进展和有效 execution 投影；不读取无关 Session 历史。浏览与查询不触发模型。

### 架构设计

模型请求在持久 snapshot 写锁之外执行；独立 planning 文件锁串行化预览。提交时重验规则版本和完整依据，竞争期间来源、Block 或工作事实变化返回具名拒绝。已提交 command ID 重放返回原计划，不重复调用模型。

真实模型适配器要求完整 JSON 与 stop 结束，不提供固定排序或 fallback。失败保存 `planning.error`，原计划历史仍保留。

### 组件模块

| 组件 | 职责 | 状态 |
| --- | --- | --- |
| WorkApplication | operator 命令、版本校验、事务记录 | work-v3 snapshot |
| work-planning | 模型输入投影、输出 schema 与范围校验 | 无独立权威 |
| work-planning/llm | 公开宿主 LLM stream、纯文本 JSON 输出 | 无 Session、无工具 |
| work-continuous | 原 serial scheduler 资格与安全槽位 | 同一规则记录 |

### 数据流程

原话 → 授权规则草案 → 明确预览 → LLM 候选 → 身份/范围/Block/覆盖校验 → 版本计划及依据落盘。`continuous.block` 只接受已观察的稳定 node ID，不能用跨仓库裸 number。原话保存与预览均不启动工作。

## 场景

### 接入与生成预览

前置：已有受信 GitHub Project 完整 snapshot 和已配置的执行资源。通过公开工作命令先 `continuous.instruct {projectId,sourceId,expectedVersion,text}`，随后 `continuous.preview {projectId,sourceId,expectedVersion}`。查询 `continuous.status` 可见原话、补充、Block、版本计划、每步 why/nextAction/mode。完成判据为计划落盘且宿主执行副作用次数为零。

验证命令：

```sh
npx --yes pnpm@10.26.2 exec vitest run tests/work-continuous.spec.ts
npx --yes pnpm@10.26.2 typecheck
```

### Block 与失败恢复

`continuous.block {nodeId,blocked}` 修改持久约束并推进草案版本。重新预览必须遵守 Block；模型返回 Block、越界身份或错误负责人分别返回 `planning-blocked-issue`、`planning-outside-source`、`planning-outside-scope`。模型故障返回 `planning-model-failed`；无能力返回 `planning-model-unavailable`。重启由同一 snapshot 恢复，查询不重新调用模型。

### 明确启用与接纳已有执行

`continuous.set-enabled {enabled:true,expectedVersion}` 将最新预览版本写入 `planning.enabledPlanVersion`。草案、范围或 Block 版本未经预览则具名拒绝。已接纳的 active/等待项不由重规划重建或抹除。新接入按已启用模型步骤排列，Block 只阻止未来接入；运行中 Block 保留原协调身份与收尾。暂停规则仅停止接新，等待项原输入通过现有 inbox 与同一槽位恢复；主动暂停仍要求原公开 resume 命令。

跨来源先查 externalBindings 的 canonical TaskRef。模型计划的 existing 步骤在明确启用后才原子写入 `ContinuousWorkItem.ref`，预览不会取得 claim 或阻塞原手动执行 guard。已有 execution 的 owner、epoch、Session、原资源及策略均保持；host.check 使用已预览的原上下文，且领取时重验，既有上下文改变必须重新预览。别的规则已有 claim 时只等待/观察。未明确预览的跨资源执行不自动接管。计划下一步进入固定事件/原 kickoff，不增加平行执行器。

父项在原生子项分页未完整或已知子工作未验收时保留身份并安全让槽；不从 Issue 正文猜测结构化依赖。目前受信来源接口无原生 dependency 字段，模型能看到完整原话与已有父子/本地 Task 事实，依赖缺失不能冒称已查明。

### 后续整合

D 的 `completion.closeout === 'settled'` 与 B 的可靠 host observation 是最终组合验收前置，外部同步 pending/error 不阻塞槽位；此分支先沿 base 的本地 done report 和 host.settle 合同开发。最终 #141 需真实既有实例模型及浏览器证据。
