# Work DAO 与工作状态持久化

## 背景

工作 HTTP 接口、Agent 工具、执行恢复和会话标题维护共享同一本地工作库。旧实现为每个 WorkApplication 保存缓存，写事务重新读取、校验和序列化整个 JSON。命令结果又包含当时的执行历史，因此历史增长会放大每次小状态更新的成本。GitHub 仍是任务记录与验收的主存；这里的 DAO 只管理本地缓存与执行协调记录，遵守 ADR 0003、0011。

## 目标

- 同目录调用共享已提交快照，合并并发读取；无变化时核实热控制文件内容并复用解析结果。
- 不向读者发布未提交变化；同进程排队、跨进程锁和原子提交共同防止更新丢失。
- 普通控制状态读写不展开历史回执和执行日志；保留全部历史、命令幂等结果及当前权限、owner/epoch、接续身份。

### 非目标

不改变任务业务语义，不创建独立服务或数据库，不删除历史，不承诺多宿主协调、跨 GitHub/宿主事务或断电 fsync。完整详情、审计导出和历史重放仍需要读取所请求的数据；本次没有截断这些公共响应。

## 架构

### 概要设计

`WorkApplication` 负责授权与业务处理，`WorkDao.forDirectory(directory)` 负责数据访问。相同规范化目录共享一个 DAO。每次读取合并为同一个并发 flight，核对控制文件的 device、inode、size、mtime/ctime 和实际内容；文件身份及内容都未变时复用已解析快照，不重复 schema 校验或展开冷归档。只核对 stat 无法证明内容未变：同一 inode 的等长原地修改可能落在文件系统同一个时间戳刻度内。提交快照递归冻结，冷字段的 accessor 也明确拒绝写入。

控制内容缓存保留原始 `Buffer`，每次读取使用 `Buffer.equals()` 比较字节，只在需要解析新版本时解码 UTF-8。写提交仍通过 atomic-write 保存字符串，并把同一内容编码为字节初始化缓存；不会用重新序列化的解析结果替代外部文件的原始字节。未变文件仍完整读取，成本随控制文件大小增长，但省去重复解码和字符串比较；这不改变时间戳碰撞检查、并发 flight 或通知规则。

写者先在进程内排队，再取得原有 `work-v3.json.lock`；两段锁等待共享 30 秒预算。取得锁后重新核实文件身份，不复用锁前读取作为新鲜度证明。业务操作在独立 draft 上执行，历史/回执不进入普通深拷贝。新 sidecar 全部写成不可变文件，再原子替换控制文件，最后才发布新的内存快照和通知。回调或控制提交失败不改变可见状态；已写出的未引用文件保留供离线检查。

### 架构设计

`work-v3.json` 保留 `schemaVersion: 3` 的业务结构，并增加严格的 `storage.version: 1` 持久化协议。其 `commands` 保留 commandId/fingerprint，结果由 `storage.receipts` 指向归档；执行的 `history` 由 `storage.histories` 指向归档。`storage.sources` 指向来源正文，新增可选 `storage.checkpoints` 索引保存各来源的分页进度 head 或显式 `null`。整个索引不存在表示旧协议，首次写入迁移；索引存在时缺少任一来源条目是损坏。旧版本 strict schema 拒绝新增字段。历史引用记录 head、length、first；新追加只写当前增量和前一 head，不读取或重写历史前缀。新的命令结果通过历史引用保存当时的执行历史，后续追加不会改变旧回执。

归档统一位于 `work-v3.archive/<uuid>.json`，目录 0700、文件 0600。文件名只接受限定 UUID 形式，不能从引用跳到目录外。

- 回执文件：`{ result, history? }`；result 内执行历史为空数组，读取时补回指定历史。
- 历史文件：`{ previous?, entries }`；从 head 逆向读取、按原顺序组合，并检查数量。
- 来源文件：已发布观察、查询分页和 repository/project snapshot。
- checkpoint 文件：`{ previous?, metadata, itemCount, issueCount, items, issues }`。首块保存完整数组，后续块只保存新增或内容变化的 item/issue，metadata 保存该次 cursor、pages、身份等完整进度；按 id/nodeId 覆盖并保持首次出现顺序。冷读逆向展开，校验数量，重复 id、重排、删除等不能由追加覆盖精确表达的修改写新的完整首块。重置后旧链不再可达。

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

### 等长原地改写与损坏保护

前置：同一控制文件发生原地改写，device、inode、大小和时间戳均与上次读取一致。DAO 在合并读取内核对热控制文件内容，未知 schema 版本仍严格拒绝；查询与后续写命令都不会用旧快照覆盖该文件。有效外部更新先成为最新快照，后续命令在它之上追加。

```sh
pnpm exec vitest run tests/work-dao.spec.ts -t 'filesystem timestamps collide'
pnpm exec vitest run tests/work-process.spec.ts
```

两条确定性回归只固定文件系统时间戳分辨率，保留真实读写；分别验证未知版本拒绝并保留原字节、有效等长更新不会被后续命令覆盖。原有独立进程回归同时覆盖未知版本拒写及锁、重放恢复。读取仍只触及热控制文件；30 MB 旧库迁移后的控制读写小于 30 KB，冷归档保持按需读取。

所有协作写者仍须遵守同一文件锁和原子替换协议；内容核验不授予无锁原地写者并发写权限，也不承诺与任意外部原地修改建立事务。

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

首次迁移失败可直接重试；未引用 archive 不影响已提交状态。完整详情与离线导出会产生与所请求历史体积相应的内存和时间成本，这是显式冷路径。

### 分页进度、冷恢复和正常增长

`discovery.checkpoint` 与来源正文分别惰性读取和复制。仅更新 cursor、累计 items/issues、lease 或重试状态时，不写来源正文。checkpoint 的新 head 与全部其他控制事实在同一次 `work-v3.json` 原子替换中提交，控制提交失败仍使用原 head。新 Project 来源即使原来没有 discovery 对象，也会保存首次分页进度。当前完整扫描结束时才更新观察和 projectSnapshot、移除 checkpoint；进程重启由 checkpoint 链恢复之前的完整累计结果。

```sh
pnpm exec vitest run tests/source-storage.spec.ts tests/project-discovery.spec.ts
node --experimental-transform-types scripts/benchmark-source-storage.mjs
```

基准使用实际 NVMe 文件：约 20 MB 来源正文、17 MB 已累计 checkpoint，五页各新增一条 20 KB Issue，并执行来源 reservation 的完整 clone。对比旧 DAO 与当前 DAO 的真实新增 archive 字节，结果记录于本地 `docs/artifacts/a2d2-source-storage-2026-11-01/benchmark.json`；仓库提交公共摘要 `docs/verification/source-storage.md`，本地日志和验收记录不入 Git。checkpoint 的正文只写初始首块和各页真实新增/更新数据，控制仍为引用。全量扫描完成时，观察时间等事实变化仍可能新增一份来源正文；命令回执和执行历史也继续保留。这是正常增长，需按实际磁盘使用离线维护，不声称存储总量恒定，不设置自动重启任务。

### 离线可达备份和归档清理

**前置**：停止该工作目录的全部读者与写者，保持停止直到备份及清理结束。writer lock 不能保护另一个进程已持有的惰性旧快照，因此此接口不支持在线清理。`--offline` 是维护者对停止条件的明确声明，不能自动停止服务。旧未拆分库先在安全窗口执行 `ensureSourceSplit()`/`migrate()`；带 `storage` 的旧 v1 来源正文可直接审计。

```sh
# 工作目录：已构建 checkout，或已安装 package；替换为真实数据目录。
node scripts/work-archive-gc.mjs --offline /absolute/work-directory
# 上一条输出 manifest 路径。审核并备份后，仍保持服务停止：
node scripts/work-archive-gc.mjs --offline /absolute/work-directory --apply
```

也可从构建包调用 `WorkDao.forDirectory(directory).collectArchives({ offline: true, dryRun: true })`。默认 dry run；`dryRun: false` 才删除。维护操作在普通 writer lock 内重新读取控制根，校验全部可达数据后，在数据目录写 `work-v3.gc-<uuid>.json`，最后才逐个删除候选。清单包括控制字节数与 SHA-256、全部 reachable 文件名、role、候选文件名/字节数、各类总字节数和 ignored 列表。删除中断可在停止状态下重新运行，剩余候选会重新计算。

遍历的根包括 `storage.receipts`、`storage.histories`、`storage.sources`、`storage.checkpoints`、当前 continuousRules 的 screeningReview，以及回执中 continuousRule 的 screeningReview；递归保留历史、checkpoint 和 screening 的 previous 链。历史长度采用 memo 计算，避免共享长前缀的重复遍历。checkpoint 首块和增量均校验累计数量。缺失、损坏、非普通文件、冲突类型、循环或数量不匹配时，在删除前失败。不解析不可达的大来源文件，因此不会扫描整个数百 GB 旧正文。只删除本归档目录中严格 UUID 文件名的普通文件；手工文件、子目录、符号链接和旧 `work-v3.sources` 保留。

**可达备份**：服务停止时复制 `work-v3.json` 和 manifest 的全部 `reachable` 相对文件到备份的 `work-v3.archive/`，保留权限与 manifest。若仍使用旧 v1 格式，此图也包含其 source bulk 内的 checkpoint。manifest 不替代备份本身；核实备份能完整导出后才执行 apply。无需为恢复复制已证明不可达的历史来源正文。不能按日期清理 archive，旧命令回执仍可能指向早期历史和 screening 链。

**完成判据**：apply 返回可删除数量和字节数；控制 SHA-256 不变、全部 reachable 仍存在，备份/清理前后 `exportSnapshot()` 一致。原文件目录完整备份和显式旧格式导出仍是回退边界。

历史开发实例可能保留 Issue #197 版本写入的 `Project.executionDefaults`。存储 schema 使用原字段的严格定义接受并完整保留 resource、model（含 reasoningEffort）、agentPreset、permissionPreset；迁移、普通提交和导出均不删除配置。此兼容边界不恢复旧版本的启动选择行为，未知字段仍拒绝。
