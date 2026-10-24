# 发布要求

源码采用 Apache-2.0，第三方依赖保留自己的许可证。包名、Cordis 挂载入口和浏览器 bundle 统一为 `@a2d2/dsh-a2d2`。默认分支 `main` 是后续版本的唯一整合来源；当前开发版本为 `0.0.23-dev.0`，既有 `v0.0.22` 是不可变的历史预发布标签。

## 分支与版本

- 功能与修复 PR 默认合并到 `main`。长期发布分支只用于已声明的维护版本，修复应回到 `main`；不要在无人检查的发布分支持续开发下一版。
- 不移动已发布标签、不用同一个版本覆盖不同源码。发布准备 PR 同时更新 `package.json`、`dsh.plugin.json`、`CHANGELOG.md` 和双语安装示例，去掉开发版本后缀。
- 版本准备 PR 合并且 Node 22、24 与 secrets 检查通过后，在该 main 提交创建 `v<package.version>` 标签。
- `verify:repository` 校验包身份、manifest 版本、挂载导出和源码排除规则。带 `--tag` 时还要求标签精确匹配版本、checkout 等于标签提交、提交可由 `origin/main` 到达，且不使用 `dev` 开发版本。
- CI 检查所有分支 push、PR 和 `v*` 标签；手工 `Release candidate` 工作流只构建已有标签、产出 tarball、`SOURCE_COMMIT` 与 `SHA256SUMS`，不会自动上传 Release、发布 npm 或改变可见性。Node 24 和 secrets 检查仍须另外核对同一标签提交的 CI。

## 可重复构建

使用 Node.js 22 或 24 和 `package.json` 锁定的 pnpm 10.26.2。在干净 checkout 中运行：

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm verify:repository
pnpm typecheck
pnpm test
pnpm test:node
pnpm verify:pack-exports
pnpm pack --pack-destination /absolute/path/to/output
```

`verify:pack-exports` 从已提交的 `HEAD` 导出干净源码，通过 `prepack` 从零构建并打包，核对全部显式导出、类型、挂载 sidecar，再安装同一 tarball 并导入公开 Node 入口。未提交工作树会被拒绝。构建产物不提交 Git，测试图片、会话快照和本机状态不放源码树；测试证据放在 [a2d2-dev/project](https://github.com/a2d2-dev/project)，见[测试约定](testing.md)。

发布标签的额外校验命令：

```sh
node scripts/verify-repository.mjs --tag v0.0.23
```

此处版本仅为流程示例，运行时必须与 checkout 中的版本和真实标签一致。发行说明应列明源码提交、主干 CI、包校验和、实际宿主版本、功能验证和已知限制。使用同一个已验证 tarball 作为发行附件，不用 GitHub 自动生成的源码压缩包代替构建包。

## 宿主与外部依赖

- 当前 peerDependencies 基于 DSH 0.2.0-rc.2 API 系列；这不保证同版本的所有官方宿主都具备所需能力。
- 根会话、浏览器会话和交接的 Agent 初始化仍要求 `sessionController.selectLocalModel`；缺少时明确拒绝。已核对的上游 [`687f282e`](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/api/session-controller/src/index.ts) 未定义该方法，其包版本为 `0.2.1-rc.2`。首次提供能力的公开宿主版本仍需确认，不能用本地开发宿主的验收替代，也不能回退到修改默认值的 `selectModel`。
- 子代理 dispatch 使用另一条契约：优先 `startActivation`，方法不存在时才用 `startContinuable`；它不证明根会话初始化兼容性。
- Node.js 22 是下限；GitHub watch 使用原生 WebSocket。开发 pnpm 版本与桌面应用内置安装器版本可以不同，见 [Git 安装](git-installation.md)。
- `gh` 认证、模型提供者、可选 `ask-matt` / `handoff` skill 及通知服务由使用者配置。
- GitHub watch 默认向 A²D² 运营的 `https://hooks.a2d2.dev` 发送 GitHub token，申请订阅票据；启用前必须信任运营方，自托管可配置 `relayUrl`。参见[安全政策](../SECURITY.md)。

## 公开发布门槛

1. 核对贡献者授权、第三方代码和随包 bundle 的许可证及必要署名。
2. 核查拟公开的全部分支、标签、历史、PR 引用与发行附件，并人工检查图片。CI 中固定版本 Gitleaks 的精确误报忽略不等于隐私审查。移走当前树中的文件不会清除历史；确认真实凭据暴露时先轮换，再协调历史清理。必要的 force push 需基于清理前的备份、完整引用清单和清理后验证，不能只重写 main 后就宣称所有历史干净。
3. 在未经修改的公开 DSH 宿主上通过 tarball 验收配置、模型选择、dispatch、handoff 与页面，记录确切宿主版本；独立构建和 mocked tests 不替代它。
4. 确认 registry 名称、发布权限、版本和 tarball 清单；尚未验证 npm 发布时不宣称可以从 registry 安装。
5. 经授权再改变仓库可见性并启用分支保护。当前私有仓库套餐拒绝 ruleset API（HTTP 403），CI 通过不代表保护已启用。

## main 保护与分支清理

[规则配置](../.github/main-ruleset.json)要求 PR、至少一位其他评审批准、新提交撤销旧批准、解决 review 对话、禁止删除和强推，并要求 `checks (Node 22)`、`checks (Node 24)`、`secrets` 成功。套餐允许后由维护者读取现有 ruleset，再用已审阅配置创建或更新；不要依赖过时的规则 ID。

开启合并后自动删除远端任务分支，避免继续积累。既有分支只有在确认已合入 main、没有开放 PR、不是发布/保护分支且没有仍在使用的工作树后才删除；当前检出分支和测试资料保留策略要单独核对。
