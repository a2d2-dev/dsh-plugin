# dsh-a2d2 0.0.1 本地发布包（2026-10-22）

首个本地构建包，对应 UI 迭代 PR #171 的 `37bb7c0`。

| 项 | 值 |
| --- | --- |
| 包 | `dsh-a2d2@0.0.1`（MIT） |
| 文件 | `/data/_dsh-builds/releases/dsh-a2d2-0.0.1.tgz` |
| SHA256 | `634aa5ecbebb5be2cc83529c802bf973a8f46514d3aabb2bf583af1ffbdbbc58` |
| 大小 | 563,584 bytes · 168 files |
| 源 | `feat/panel-ui-iteration` @ `37bb7c0`（PR #171） |
| 自检 | `pnpm verify:pack-exports` 通过（14 个导出全部可导入） |

安装到 DSH profile（示例）：

```bash
cd <profile 目录>
pnpm add file:/data/_dsh-builds/releases/dsh-a2d2-0.0.1.tgz
# 或交给插件管理器：dsh plugin --profile web add file:/data/_dsh-builds/releases/dsh-a2d2-0.0.1.tgz
```

## 命名现状

- 包名暂用 `dsh-a2d2`：和 18780/18783 的 profile、`cordis.patch.yml` 的 `name: dsh-a2d2` 一致，换名会连带改 profile 依赖与 `bundles`。
- `@deepseek-ai` 是 DeepSeek 的公开 scope（`@deepseek-ai/dsh-agent` 已有 0.1.0-rc.6），发布需要该组织成员权限；README 里写的 `@deepseek-ai/dsh-a2d2` 目前只是目标名。
- `dsh-a2d2` 与 `@a2d2-dev/dsh-a2d2` 在 npm 上都未占用；本机没有 npm 登录（`npm whoami` → `ENEEDAUTH`）。
- 要发云端时先定 scope，再迁移 profile 依赖；本地包不受影响。

## 可复现性提醒

同一 `37bb7c0` 的两次构建，client bundle 只有 CSS module 映射的 **key 顺序**不同（已部署的 `36c258d7…` vs 本包的 `50aae345…`），字节长度相同、类名一致、功能等价。发 registry 前应把 CSS 映射按 key 排序，让两次构建字节一致，否则版本校验/校验和会对不上。
