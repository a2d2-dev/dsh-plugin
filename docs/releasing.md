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

CI 在 Node.js 22、24 上执行上述检查，另运行固定版本 Gitleaks 扫描 Git 历史。发布包验证覆盖所有显式导出目标、类型入口、Node 模块导入及浏览器 bundle 注册。源码内部路径不是公共导出接口。构建产物不提交 Git；本地验收报告和截图也不随源码或 npm 包发布。

## 宿主与外部依赖

- 当前 peerDependencies 基于 DSH 0.2.0-rc.2 API 系列；这不是所有功能在任意同版本宿主上可用的保证。
- 会话 Agent 初始化要求 `sessionController.selectLocalModel`，缺少时明确拒绝。首次提供此 API 的公开 DSH release 尚未验证；必须在公开发布前确认并记录该宿主版本及安装验收结果，不能用本地补丁宿主替代。
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
