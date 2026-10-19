# #121 第一阶段：本地工作后端实现与验证

## 背景

旧任务以项目目录和 Issue 寻址，旧 YAML writer 仅保留既有字段；旧面板查询依赖 live Session。它们不能承载 v3 的独立 Project、Project Agent、Task 身份。本阶段只交付后端，UI 与真实浏览器验收另派。

## 目标与非目标

以公开 WorkApplication.execute/query 为行为接缝，保存无 GitHub、remote、Issue、在线 Session 的本地工作。此阶段不迁移旧活动任务、不取得协调权、不启动模型、不改变宿主服务或客户端。

## 架构

WorkApplication 在独立目录的 work-v3.json 保存 schemaVersion=3 快照；Project/Agent/Task ID 由随机 UUID 独立生成，目录与显示名称均不是身份。项目创建自动实例化默认协调职责 Agent，默认策略不声明未经核实的模型路由。

依赖宿主公开 @deepseek-ai/dsh-atomic-write。withFileLock 将同一文件的短事务串行化；writeFileAtomic 用同目录临时文件与 rename 提交完整快照，读者看到旧或新记录。适用单宿主、同 PID 命名空间；不承诺断电 fsync。新文件名与目录不交给旧 YAML writer。

## 场景与验证

### 本地工作保存与重载

调用 project.create，再以返回的 ProjectId 调用 task.create，保存目标、规格和版本化验收；新建 WorkApplication 实例以 task.detail 与 project.detail 查询。观察稳定 Task/Project/Agent ID 和完整规格内容。

工作目录为本票 worktree，执行：

```sh
pnpm exec vitest run tests/work.spec.ts
```

2026-10-19 初始红测：最小公开接缝返回 failed，断言期望 completed，退出 1。实现独立身份与真实持久化后：1/1 通过，退出 0。更早缺失模块的导入失败不作为行为红测证据。

命令回执与领域记录同事务保存。第二条红测：6 个独立应用实例并发提交同 commandId 生成 6 个身份，退出 1；实现持久 ledger 后 2/2 测试通过，退出 0。同名项目用不同 commandId 创建各自独立身份；同 commandId 内容不同时返回 command-id-reused，未授权重放在读取回执前拒绝。

规格更新采用 Task expectedVersion；旧规格和验收标准进入 specificationHistory，新标准有独立规格版本。第三条红测无成功更新（退出 1），实现后 3/3 通过（退出 0）；两个并发编辑仅一个成功，另一个得到 currentVersion=2 的 version-conflict。

父 TaskRef 创建子任务与已有子任务关联同事务保存双向关系；跨项目和循环关系拒绝。第四条红测 task.create-child 返回 failed（退出 1），实现后 4/4 通过（退出 0），重载可读完整父子详情。

工作拆解按稳定 block ID 保存，不自动生成子 Task 或 Session。第五条红测返回 failed（退出 1），实现后 5/5 通过（退出 0）；重复 block ID 拒绝且不改变原版本。

## 宿主与环境基线

只读核验宿主实际 HEAD：a45068d2ec03326c800c68c9bdcd47508e3ccb9c。已读取 atomic-write 与 workspaceRegistry 公共源码，未修改宿主。pnpm 11.7.0。首次 pnpm exec 自动安装依赖时报告未批准构建脚本（subprocess-local、koffi、node-pty），之后 vitest 可运行；完整安装/构建能力后续核实，不将安装告警判作产品缺陷。

## 公开接入合同

src/work-types.ts 是不含宿主依赖的客户端类型合同；WORK_ROUTE_PATH=/a2d2/api/work。POST JSON envelope 为 {kind:'command'|'query',value:WorkCommand|WorkQuery}，返回 WorkResult。其余命令类型先固定供并行 UI 编码，行为实现与生产路由仍按下方待办逐片验证，类型存在不等于验收已通过。

## 尚待本阶段完成

命令去重、版本冲突、工作拆解/父子关系、宿主资源校验、生产可信 UI 路由、并发/故障验证与完整检查正在后续纵向切片实现。本文仅描述已核实事实，未完成项不算验收通过。
