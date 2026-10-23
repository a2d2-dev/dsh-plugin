# 发布要求

源码采用 Apache-2.0（根目录 `LICENSE`），第三方依赖保留自己的许可证。包名、Cordis mount row 和浏览器 bundle 统一为 `dsh-a2d2`，不使用上游 `@deepseek-ai` 发布空间。

## 可重复构建

使用 Node.js 22 或更高版本和 `package.json` 锁定的 pnpm。在干净 checkout 中运行：

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm verify:pack-exports
```

CI 在 Node.js 22、24 上执行上述检查，另运行固定版本 Gitleaks 扫描 Git 历史。`.gitleaksignore` 仅列出逐项核实的历史摘要、脱敏测试常量和已遮罩/占位授权头的精确 fingerprint，不豁免目录或整类规则。发布包验证覆盖所有显式导出目标、类型入口、Node 模块导入及浏览器 bundle 注册。源码内部路径不是公共导出接口。构建产物不提交 Git；本地验收报告和截图也不随源码或 npm 包发布。

## Git 安装授权检查

官方桌面端 `0.2.1-rc.2` 的安装器使用 pnpm `11.28.5`。涉及 Git 安装或打包钩子的改动，另运行以下网络集成检查（传入可从 GitHub 获取的完整 commit）：

```sh
npm exec --yes --package=pnpm@11.28.5 -- node scripts/verify-git-install.mjs dc944315c3d4a4d21e32b4f81fbb5d6521b2d141
```

检查使用全新临时项目和独立 pnpm store：先断言缺少授权时出现 `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`，再添加精确的 Git commit `allowBuilds` 条目，确认安装成功、导出文件和 sidecar 齐全，并导入所有 Node 入口。不会修改实际 DSH profile；成功后删除临时目录，失败时保留日志。首次运行需要下载 pnpm、Git 源码及依赖，适合作为手动发布检查。此检查验证指定远端提交的包管理器安装，不替代原生桌面端 UI 与插件功能验收。

Git prepare 阶段包含本插件的 `prepack` 构建。目标 profile 的授权不能由插件自己的配置代替。用户操作见 [中文安装说明](../README.zh.md#官方桌面端git-构建授权) / [English installation guide](../README.md#official-desktop-authorize-git-builds)。

## 宿主与外部依赖

- 当前 peerDependencies 基于 DSH 0.2.0-rc.2 API 系列；这不是所有功能在任意同版本宿主上可用的保证。
- 会话 Agent 初始化要求 `sessionController.selectLocalModel`，缺少时明确拒绝。首次提供此 API 的公开 DSH release 尚未验证；必须在公开发布前确认并记录该宿主版本及安装验收结果，不能用本地补丁宿主替代。
- 上游源码核对：DSH `master` 提交 [`687f282e`](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/api/session-controller/src/index.ts) 的公开 session-controller 定义包含 `selectModel`，没有 `selectLocalModel` 方法定义；对应包版本为 `0.2.1-rc.2`。因此不能宣称升级到这个版本即可满足会话本地模型选择。需先补齐上游公开能力，再完成原生宿主验收；禁止回退到会修改默认值的 `selectModel`。
- Node.js 22 是运行下限；GitHub watch 使用原生 WebSocket。
- `gh` 认证、宿主可用模型、`ask-matt` / `handoff` skill 及可选通知服务由使用者配置，插件不提供模型账号或捆绑这些服务。
- GitHub watch 默认连接 `https://hooks.a2d2.dev`，通过 Authorization header 发送用户 GitHub token 申请订阅票据。启用前须信任服务运营方；自托管时可配置 `relayUrl`。禁止把凭据写进报告、日志或仓库。

## 公开发布门槛

1. 核对贡献者授权及第三方代码、随包 bundle 的许可证和必要署名；Apache-2.0 不能覆盖第三方的许可证义务。
2. 扫描拟公开的全部分支和标签，而不仅是当前目录。对历史中真实泄露的凭据先轮换，再协调历史清理；删除文件或加入 `.gitignore` 不会清除历史。验收截图还需要人工检查，文本扫描不能证明图片已脱敏。
3. 在未经修改的公开 DSH 宿主上，通过 tarball 安装，并验收配置保存、模型选择、dispatch、handoff 和浏览器页面。仅构建、静态检查或 mocked tests 不能代替它。
4. 确认 registry 包名可用、发布权限、版本号、变更记录以及 npm tarball 清单；尚未发布时不宣称可从 registry 安装。
5. 显式授权公开仓库后，启用 `main` ruleset：PR 合并、至少一人批准、新提交撤销旧批准、解决所有 review 对话、禁止删除和强推、要求 `checks (Node 22)`、`checks (Node 24)`、`secrets` 成功。不要把尚未产生过的检查名误配为门禁。

GitHub 当前私有仓库套餐拒绝分支保护 API（HTTP 403）；新增 CI 不会自动启用分支保护，也不会改变仓库可见性。

## main 保护规则配置

[可审阅的 ruleset 配置](../.github/main-ruleset.json) 匹配 `main`，不配置绕过者；要求 PR、至少一人批准、最后推送由其他人批准、新提交撤销旧批准、解决 review 对话，以及来自 GitHub Actions 的三项 CI 检查成功。禁止删除和强推，并要求分支与目标主干保持最新。

待套餐允许且这些 CI 检查已实际运行后，可更新现有规则（不会更改仓库可见性）：

```sh
gh api --method PUT repos/a2d2-dev/dsh-plugin/rulesets/25704910 --input .github/main-ruleset.json
```

这是待应用配置；文件进入 Git 不代表 GitHub 已启用保护。
