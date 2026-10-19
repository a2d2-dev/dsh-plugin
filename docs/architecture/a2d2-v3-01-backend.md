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

受信资源端口返回 runtime/workspace 引用，ProjectId 与资源分别保存；资源跨项目唯一归属在快照事务内判断。Session 使用 runtime/session 复合引用，候选受项目资源过滤，关联只保存 related/review 观察关系，不产生协调事实。第六条红测 project.attach-resource 返回 failed（退出 1），实现后 6/6 通过（退出 0）。此条使用可控宿主边界端口，真实 DSH 适配仍待下片验证。

## 宿主与环境基线

只读核验宿主实际 HEAD：a45068d2ec03326c800c68c9bdcd47508e3ccb9c。已读取 atomic-write 与 workspaceRegistry 公共源码，未修改宿主。pnpm 11.7.0。首次 pnpm exec 自动安装依赖时报告未批准构建脚本（subprocess-local、koffi、node-pty），之后 vitest 可运行；完整安装/构建能力后续核实，不将安装告警判作产品缺陷。

## 公开接入合同

src/work-types.ts 是不含宿主依赖的客户端类型合同；WORK_ROUTE_PATH=/a2d2/api/work。POST JSON envelope 为 {kind:'command'|'query',value:WorkCommand|WorkQuery}，返回 WorkResult。其余命令类型先固定供并行 UI 编码，行为实现与生产路由仍按下方待办逐片验证，类型存在不等于验收已通过。

## 宿主生产接线

bundle 的 a2d2-work 行挂载 dsh-a2d2/work-plugin，独立于 live Session、Agent 和 LLM。默认记录目录为 ${DSH_HOME:-~/.dsh}/a2d2/work-v3；runtime-v1.json 原子生成并保存稳定 runtimeId，work-v3.json 保存领域快照。可通过服务端配置 directory 指定隔离目录，浏览器没有路径参数。

DshWorkHost 只读取 workspaceRegistry.list/status、经过宿主验证的 sessionIds 与 sessionPersistence.stat 或 live header，并在关联前检查实际 canonical cwd 与 workspace.path 相等。仅服务器已登记且目录有效的 workspace 可作为资源；不恢复 Session、不调用 SessionController、不申请执行资格。资源全局只能属于一个领域项目，避免同一资源被隐式用于跨项目关联。

POST /a2d2/api/work 使用 application/json、1 MiB 上限与 strict schema；首先复用 connection.requestRejection 的宿主 operator 登录/Host/Origin 边界，然后才读 body。WorkResult completed 对应 HTTP 200、conflict 对应 409、具名业务失败对应 400；宿主能力缺失或记录不可安全访问为 503。响应无凭据和服务器异常路径。公开生产入口不是 fixture 内部 Store CRUD。

### API 使用场景

以下为合同调用示例，需在已登录 DSH 的同源客户端调用：

```ts
const response = await fetch('/a2d2/api/work', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ kind: 'command', value: {
    type: 'project.create', commandId: crypto.randomUUID(), name: '本地需求',
  } }),
})
const result = await response.json() // WorkResult；project.id 是独立 ProjectId
```

随后 task.create 保存完整内容，task.detail(ref) 查询；resources.list 取得可接入引用，project.create(resource) 或 project.attach-resource 接入。session.candidates(projectId) 返回兼容持久/在线会话，task.associate-session 保存观察关联，session.work(session) 反向查询。各 mutation 的 expectedVersion 是目标 Project 或 Task 当前版本；task.link-child 还要求 childExpectedVersion。相同 commandId 同内容重放已保存回执；拒绝/冲突不提交新的领域事实。

### 真实宿主隔离验证

生产插件测试先因未注册 handler 得到行为红测（退出 1）；实现后 work + work-host 共 8/8 通过（退出 0）。使用真实 SessionStore、JsonlSessionPersistence、StorageDomain/StorageJson 与 WorkspaceRegistry；认证/路由注册使用结构化宿主边界替身，不冒称浏览器实证。Session 采用宿主真实 v4 header 并 flush 后发现，关闭 Context 后重建仍能按 ProjectId 查询；未装载 Agent/LLM，关联前后 Session stat（header/revision/eventCount）不变，未启动模型或创建 live Session。更早 Session fixture 的格式与 flush 前置失败不计入产品红测。

认证测试覆盖命令、查询和已存在 commandId 的回读；拒绝在 body 读取前成立。额外浏览器 cwd 字段被 strict schema 拒绝。pnpm typecheck 退出 0。

## 旧地址唯一映射契约

legacy.map(ref,address,expectedVersion) 在相同领域事务中保存唯一 (runtimeId,projectRoot,旧 TaskId) → TaskRef。地址必须是绝对、normalize 后相等的历史规范地址；未来迁移调用方须先解析真实旧项目根，不能把别名当另一身份。此入口仅保存地址元数据，不读取旧文件、不复制活动任务、不更换 writer/runner。legacy.resolve 返回唯一已接受 TaskRef；同地址指向另一 TaskRef 返回 legacy-address-in-use。两个应用实例竞争只有一个映射成功，重载可解析同一身份。该片红测无成功映射退出 1，实现后 work + work-host 9/9 通过退出 0。

## 尚待本阶段完成

独立进程并发/故障验证与完整检查仍在推进。UI 与浏览器验收未验证，交后续切片。
