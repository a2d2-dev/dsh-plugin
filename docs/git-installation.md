# Git 安装与构建批准

普通桌面用户优先下载 Release 的已构建 `.tgz`，保持压缩并通过绝对路径安装。不要安装自动生成的 Source code 压缩包；也不需要为安装插件重新编译整个 DSH。实际使用 `desktop` 还是 `web` profile，应与正在运行的应用一致。

Git URL 安装与本地源码目录不同：源码目录必须先构建，Git 依赖可由 pnpm 在准备包时执行 `prepack`。`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` 表示安装器要求授权该构建，不表示打包 hook 应被删除。跳过脚本会留下缺少 `lib/` 的包。

## 桌面安装器

[#205](https://github.com/a2d2-dev/dsh-plugin/issues/205)的官方 Desktop `0.2.1-rc.2` 使用 pnpm `11.28.5`；本仓库开发环境锁定的 pnpm `10.26.2` 是另一项配置。

1. 等本次失败安装结束，记录错误中的完整批准 key、目标 profile 目录与提交 SHA。
2. 打开该 profile 的 `pnpm-workspace.yaml`，通常为 `~/.dsh/profiles/desktop/pnpm-workspace.yaml`。不要改插件源码仓库或其他 CLI 的 profile。
3. 保留已有配置，将错误提供的精确 key 合并进 `allowBuilds`；避免重复顶层 YAML key。只有信任该仓库与提交的构建脚本时才批准。
4. 保存后在原失败对话框点击 Retry；新提交应重新核对错误中的完整 key，不使用通配符或全局放开依赖构建。

下面是结构示例；尖括号必须换成错误里打印的真实值，包名也必须照抄错误，不能把旧的未带 scope 包名套到新版本：

```yaml
allowBuilds:
  '<exact-package-name>@git+https://github.com/a2d2-dev/dsh-plugin.git#<full-commit-sha>': true
```

使用 UI Retry 不需要注册 CLI。若使用命令行，应通过桌面应用自己的 **Manage dsh Command… → Install** 注册命令，完整退出应用后再操作对应 profile；另行 npm 安装的 `dsh` 不一定管理同一桌面 profile。

```sh
dsh plugin --profile desktop add 'git+https://github.com/a2d2-dev/dsh-plugin.git#<full-commit-sha>'
```

撤销批准时只移除对应条目。构建批准只解决安装权限，完整功能仍受[宿主兼容性要求](releasing.md#宿主与外部依赖)约束。

## 维护者回归

`verify-git-install.mjs` 使用真实 pnpm、新的临时项目和独立 store，先验证缺少批准确实失败，再验证精确批准后可以安装、导入所有公开 Node 入口。它不修改任何 DSH profile。

```sh
npm exec --yes --package=pnpm@11.28.5 -- node scripts/verify-git-install.mjs <full-commit-sha>
```

这是需要网络和源码访问权限的按需检查；私有仓库也要求该安装进程拥有合法 Git 访问权限。它不在普通离线单元测试中运行。切勿将真实认证信息写入日志或批准示例。
