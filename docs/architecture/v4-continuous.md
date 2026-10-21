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

### 独立委托组件接线清单

本分支新增 `src/client/continuous-delegation.tsx`、`continuous-controller.ts` 与独立样式；按任务边界没有编辑 `work-panel.tsx` 或 `work-panel-controller.ts`。最终整合者接线：

1. 来源表头保持摘要在左，在右侧的“持续处理” disclosure 内导入并渲染 `ContinuousDelegation`。
2. 传入同一个稳定 `WorkClient`、选定来源的 `projectId/sourceId/sourceTitle`、`continuous.status` 的最新 `continuousRule`。未配置规则时沿原资源配置入口完成 `continuous.configure`，初次保持 `enabled:false`。
3. `onRuleChanged` 使用稳定回调更新该来源缓存；既有状态刷新只更新 `rule` prop，不能重建/覆盖组件草稿。切来源的 props 改变仅切展示，不发送启用/停用命令。
4. 组件自己发送 `continuous.instruct/preview/block/set-enabled`，不需要面板 controller 新增命令分支。禁止在 render、effect、浏览或刷新中调用 preview。
5. 模型步骤只显示原因、下一步、新建/已有/等待，另呈现既有 execution 的原资源、模型、权限方案和会话，明确启用承认该原上下文。没有手动排序或删除计划行。

草稿和未知命令回执身份按来源保存到浏览器 localStorage（不可用时保持当前输入）。慢保存只清除仍等于提交文本的草稿；后台 props 更新不会覆盖新输入。网络回执未知时只能核对/重试同一个 commandId，防止盲目再启用或重复模型预览；已知服务端拒绝允许修改后新提交。

组件合同验证：`npx --yes pnpm@10.26.2 exec vitest run tests/continuous-client.spec.ts`。agent-browser 已打开既有 `http://127.0.0.1:18781` 并截图，实际页面仅登录表单；本会话未取得已登录实例，未验证新组件的真实页面交互，也未启动替代服务器。最终 #141 必须补已登录实例桌面/窄屏截图、真实模型与两项串行证据。

### 后续整合

D 的 `completion.closeout === 'settled'` 与 B 的可靠 host observation 是最终组合验收前置，外部同步 pending/error 不阻塞槽位；此分支先沿 base 的本地 done report 和 host.settle 合同开发。最终 #141 需真实既有实例模型及浏览器证据。

## 本分支验证记录

- 初始公开预览测试由 `invalid-command` 红转绿；启用测试由提前启动红转绿；已有执行由 skipped/缺少 active 红转绿。
- `pnpm@10.26.2` 执行相关 7 文件、91 项测试：75 passed / 16 failed。continuous 公共合同 22/22、独立 client 2/2、work 9/9、sources 29/29、progress 6/6 通过。真实 work-execution 15 项默认超时/fixture未 settle；continuous integration 首轮 1 项超时，单独复现 2 项均超时。没有放大 timeout 或跳过测试伪绿。
- header checkpoint 单独复现保留 fixture `/data/_dsh-dev/tmp/a2d2-execution-GhtU5E`，仅存在 workspace storage 临时文件，无 Task snapshot 或 Session。更深宿主原因在本分支未验证；最终整合在受控环境复验。
- `npx --yes pnpm@10.26.2 verify:pack-exports` exit 0，构建及 14 个 Node 公开入口均 verified。生成产物未提交。
- 浏览器只验证到既有实例登录页，新组件桌面/窄屏交互与真实模型调用尚未验证。

