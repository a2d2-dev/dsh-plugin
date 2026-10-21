# v4 Task 完成架构

## 背景

`work_report` 已校验当前规格、逐项证据、阻塞、拆解和独立子 Task。此前成功只保存进度与 wait，没有完成操作，也未阻止普通 Task 恢复推进。

## 目标

- 同一事务提交验收、稳定完成操作、收口意图和父结果。
- 普通与 continuous Task 完成后均拒绝新的推进、改规格及 resume；历史可读。
- 外部同步独立恢复，绝不重建 Task 或启动模型。

### 非目标

旧 complete_task、来源目录、PR 语义、生产部署。

## 架构

### 概要设计

WorkApplication 唯一写入 `work-v3.json`。已有验收检查成立后，`commitCompletion` 在同一快照内保存 Task.completion、父 Task.childCompletions 和父执行的稳定 result inbox 事件。事务提交前没有通知或远端副作用。

### 架构设计

CompletionOperation 保存 operationId、commandId、规格版本、executionId、owner、epoch 和时间。完成后命令写入与原生执行 guard 均检查完成事实，旧版当前规格 done 也保持终态。相同 command 重放返回原回执，新的完成报告不会重建操作。父结果事件使用 completion:<operationId> 去重；父尚无执行时结果保存在领域 Task，开始时才入 inbox；事件投递、消费与父自己的验收分别成立。

### 组件模块

| 组件 | 职责 | 状态归属 |
| --- | --- | --- |
| work-progress | 保留既有验收检查并提交完成 | Task.progress |
| work-completion | 稳定操作、父结果、终态判断 | Task.completion / childCompletions |
| WorkApplication | 授权、锁、原子持久化、执行栅栏 | work-v3.json |

### 数据流程

协调会话 → sessionReport → owner/epoch 校验 → 既有验收 → 同事务完成及父 inbox → 原子写入 → 宿主按原有投递回执处理。

## 场景

### 接入与本地验收

在本工作树运行：

```sh
pnpm exec vitest run tests/work-progress.spec.ts
```

公共 work_report 接受当前规格证据，task.detail 返回 completion。新 WorkApplication 实例读取同一 operationId；sessionControl resume 返回 task-completed，stage 保持 done。父自身仍须通过全部标准与必要子工作校验。

### 中断与恢复

提交前中断无完成事实或通知；提交后重放读取原命令回执。父结果随完成一起保存，不存在通知成功但子完成未落盘的窗口。closeout 初始 pending，必须由正式宿主结算能力证明相关委派和 job 已收齐后才能标记 settled；idle 不能替代结算证明。

外部关闭补偿和独立 UI 合同在后续阶段补充。
