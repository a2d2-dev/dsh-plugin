# Work DAO 与工作状态持久化

## 背景

工作 HTTP 接口、Agent 工具、执行恢复和会话标题维护共享同一本地工作库。旧实现为每个 WorkApplication 保存缓存，写事务重新读取、校验和序列化整个 JSON。命令结果又包含当时的执行历史，因此历史增长会放大每次小状态更新的成本。GitHub 仍是任务记录与验收的主存；这里的 DAO 只管理本地缓存与执行协调记录，遵守 ADR 0003、0011。

## 目标

- 同目录调用共享已提交快照，合并并发冷读；无变化读取只核实文件身份。
- 不向读者发布未提交变化；同进程排队、跨进程锁和原子提交共同防止更新丢失。
- 普通控制状态读写不展开历史回执和执行日志；保留全部历史、命令幂等结果及当前权限、owner/epoch、接续身份。

### 非目标

不改变任务业务语义，不创建独立服务或数据库，不删除历史，不承诺多宿主协调、跨 GitHub/宿主事务或断电 fsync。完整详情、审计导出和历史重放仍需要读取所请求的数据；本次没有截断这些公共响应。

## 架构

### 概要设计

`WorkApplication` 负责授权与业务处理，`WorkDao.forDirectory(directory)` 负责数据访问。相同规范化目录共享一个 DAO。读缓存以文件的 device、inode、size、mtime/ctime 纳秒身份识别版本，并把 stat、文件读取及 schema 校验合并成同一个并发 flight。提交快照递归冻结，冷字段的 accessor 也明确拒绝写入。

写者先在进程内排队，再取得原有 `work-v3.json.lock`；两段锁等待共享 30 秒预算。取得锁后重新核实文件身份，不复用锁前读取作为新鲜度证明。业务操作在独立 draft 上执行，历史/回执不进入普通深拷贝。新 sidecar 全部写成不可变文件，再原子替换控制文件，最后才发布新的内存快照和通知。回调或控制提交失败不改变可见状态；已写出的未引用文件保留供离线检查。

### 架构设计

`work-v3.json` 保留 `schemaVersion: 3` 的业务结构，并增加严格的 `storage.version: 1` 持久化协议。其 `commands` 保留 commandId/fingerprint，结果由 `storage.receipts` 指向归档；执行的 `history` 由 `storage.histories` 指向归档。`storage.sources` 指向来源大字段。历史引用记录 head、length、first；新追加只写当前增量和前一 head，不读取或重写历史前缀。新的命令结果通过历史引用保存当时的执行历史，后续追加不会改变旧回执。

归档统一位于 `work-v3.archive/<uuid>.json`，目录 0700、文件 0600。文件名只接受限定 UUID 形式，不能从引用跳到目录外。

- 回执文件：`{ result, history? }`；result 内执行历史为空数组，读取时补回指定历史。
- 历史文件：`{ previous?, entries }`；从 head 逆向读取、按原顺序组合，并检查数量。
- 来源文件：观察、分页、repository/project snapshot 和 discovery checkpoint。

已有未拆分 JSON 和 `work-v3.sources/<sourceId>.json` 在首次写事务或 `ensureSourceSplit()` 中迁移；旧 sidecar 保留，不再更新。迁移前的查询只读旧格式。冷字段按需读取、校验和缓存，缺失或损坏引用报错，不用空数据兜底。带有 `storage` 标记的控制文件必须为每个来源提供自己的归档引用；缺少引用时拒绝读取与写入，只有无标记的旧格式允许读取旧来源 sidecar。控制 schema、历史项及新回执在各自写入边界校验。

`subscribe()`/`WorkApplication.onChange()` 在本地提交或读取发现外部版本变化后通知；它不是跨进程文件 watcher。既有恢复轮询保留。会话标题维护订阅通知，并在轮询取得相同快照时跳过重复标题投影，失败仍可重试。不可变归档按引用使用弱缓存，控制提交不会主动清空仍被使用的历史内容；未使用内容允许被 GC 回收。控制文件成本仍随实时业务字段和 commandId/fingerprint 索引增长，不声称所有状态规模下恒定时间。

### 组件模块

| 组件 | 职责 | 状态与依赖 |
| --- | --- | --- |
| WorkApplication | actor、版本、owner/epoch 和业务副作用协调 | 通过 DAO read/transaction；宿主操作沿用独立 lease |
| WorkDao | 共享快照、draft、锁、迁移、归档引用、提交与通知 | 控制 JSON、不可变 archive；atomic-write |
| 会话标题维护 | 名称投影与公开宿主元数据写入 | DAO 快照及变更通知，不直接解析工作文件 |
| 主存/宿主 | GitHub 任务事实、实际执行与对话 | 权威边界不变，DAO 提交不代替外部完成 |

### 数据流程

1. 查询经现有 actor 校验进入 WorkApplication，DAO 返回已提交控制快照；只在请求历史/结果时展开对应归档。
2. 写命令在锁内取得最新控制快照，业务校验与修改发生在 draft；结果回执固定当次历史引用。
3. DAO 写不可变归档，原子替换控制 JSON，发布冻结快照；随后执行既有宿主/同步后续步骤。
4. 其他进程的原子提交在下次 read 的文件身份检查中被感知；重复 commandId 按原 fingerprint 返回原结果。

## 场景

### 接入与自动迁移

前置：现有受管实例已进入允许切换的安全边界，旧新写者不能同时运行。升级前备份整个工作目录，包括来源 sidecar；不要只复制控制 JSON。插件启动沿用 `ensureSourceSplit()`，迁移仍使用相同 writer lock，不启动任务或增加权限。

隔离数据层验证命令（仓库根目录）：

```sh
pnpm exec vitest run tests/work-dao.spec.ts tests/work-store-contention.spec.ts
```

观察：30 MB 合成旧格式在迁移后具有 `storage.version = 1`，控制文件不再包含历史正文；完整导出与旧数据一致。并发冷查询仅一次 control read，小写入和历史追加不读取历史归档。真实实例部署和 UI 验证需要单独记录，测试通过不表示运行中的宿主已升级。

### 小写入、失败与重试

```ts
const dao = WorkDao.forDirectory(workDirectory)
const stop = dao.subscribe(() => scheduleRefresh())
await app.execute({ type: 'project.create', commandId, name: 'Example' }, actor)
stop()
```

状态呈现：业务回调及 archive 写入期间，查询仍看到旧快照；控制提交后才看到新项目和一次变更通知。控制写失败则返回存储错误，旧控制和历史引用仍有效；相同 commandId 重试不会把失败 draft 当作已完成，也不会改变已成功的原始结果。跨进程写者都必须使用同一个目录及文件锁。

### 离线审计与降级

旧版本的 strict schema 不认识 `storage`，会拒绝新格式，而不是把空 history/result 占位误当真实数据。不要移除 `storage` 字段后直接运行旧版本。

DAO 提供显式全量导出边界，用于**已停止所有写者**时生成旧格式。下面从已构建 checkout 读取，输出写到新的文件；它不会修改源库：

```sh
# 工作目录：已构建的插件 checkout；路径替换为受控备份目录。
WORK_DIRECTORY=/absolute/work-directory WORK_EXPORT=/absolute/backup/work-v3.export.json \
node --input-type=module <<'JS'
import { writeFile } from 'node:fs/promises'
import { WorkDao } from './lib/work.js'
const state = await WorkDao.forDirectory(process.env.WORK_DIRECTORY).exportSnapshot()
await writeFile(process.env.WORK_EXPORT, JSON.stringify(state) + '\n', { flag: 'wx', mode: 0o600 })
JS
```

导出包含全部历史、回执和内联来源数据，没有 `storage` 引用。核实导出后，由维护操作在停止写者的前提下把它作为旧版本的 `work-v3.json`，并保留原完整目录以便恢复；不要混合不同备份的控制与 archive。若恢复升级前备份，升级后的新提交不在备份内，因此发生新写入后应使用当前完整导出，而非直接退回旧备份。

首次迁移失败可直接重试；未引用 archive 不影响已提交状态。目前没有在线垃圾回收。不得按时间批量删除 archive：旧回执可能继续引用早期历史 chunk。完整详情与离线导出会产生与所请求历史体积相应的内存和时间成本，这是显式冷路径。
