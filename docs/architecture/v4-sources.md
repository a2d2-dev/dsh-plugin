# v4 来源与目录架构

## 背景

控制面板沿用 WorkApplication 的公开命令／查询和事务记录。GitHub 来源是浏览范围，业务 Project 与 Task 保存已接受工作；同一 Issue 的 ExternalBinding 继续跨来源复用 canonical TaskRef。

## 目标

- 粘贴 GitHub.com Project 或仓库 URL，真实识别名称、身份和读取账号，用户确认后保存来源。
- 保存 Project view 和 slice 原始入口，规范来源去重；浏览不启动模型或会话。

### 非目标

不改变执行 owner／epoch、持续计划、验收或外部关闭，不操作来源业务数据。

## 架构

### 概要设计

`source.identify` 解析可信 URL 并通过宿主凭据读取真实 GitHub 身份，不写本地工作。`source.connect` 接受 URL，重新识别后在事务中按真实 nodeId／规范范围复用来源。既有手动 Project 合同继续兼容。来源保存可选 title、nodeId、entryUrls；原始 view／slice 入口不作为新的来源身份。

### 架构设计

URL 只用于解析范围。适配器构造固定 api.github.com REST 或 github.com GraphQL 请求，拒绝其他主机、凭据、端口、编码路径及不受支持路径。GitHub 网络读取在本地写锁外完成，来源连接事务仅保存观察和组织关系。

### 组件模块

| 组件 | 职责 | 状态归属 |
| --- | --- | --- |
| work-sources/url | 严格解析来源范围 | 无状态 |
| GitHubSource | 宿主既有凭据、真实读取、错误分类 | 远端观察 |
| WorkApplication | 权限、公开合同、幂等连接 | 事务快照 |
| ExternalBinding | canonical Issue 到 TaskRef 映射 | 本地已接受工作 |

### 数据流程

URL → source.identify → 真实候选 → 用户确认 → source.connect → 来源记录。Issue 读取 → 来源观察 → 显式 prepareStart → 既有 canonical Task／当前执行；来源添加没有 Task 或 Session 副作用。

## 场景

### 首次接入

前置条件：宿主可读取 github.com 凭据。公开查询 `{type:'source.identify',url:'https://github.com/a2d2-dev/dsh-plugin'}` 返回真实仓库与账号。确认后发送 `source.connect`，重复规范 URL 返回同一来源。Project 的 `/views/N` 和 query／hash 参数保存在 entryUrls。

完成判据：识别后 projects.list 不变；确认后产生来源；再次确认复用来源；没有 Task／执行创建。

### 无权限与恢复

识别失败返回明确 github 错误，不生成来源。已保存工作与缓存保留；恢复权限后可重新读取。

## 验证

工作目录为本工作树；运行 `npx --yes pnpm@10.26.2 exec vitest run tests/v4-sources.spec.ts tests/work-sources.spec.ts` 验证真实适配器边界及应用事务（测试使用确定的外部 HTTP 响应，不代表生产 GitHub 验收）。最终既有实例浏览器验收归 #141。
