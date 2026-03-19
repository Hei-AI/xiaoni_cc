# WSL2 中运行 Playwright MCP 的配置指引

> 目的：解决在 WSL2 + Codex 环境下使用 Playwright MCP Bridge 时常见的 Chromium 沙箱崩溃与 “Extension connection timeout” 报错，使浏览器自动化请求可以稳定转发到 Windows 侧的已有浏览器。

## 1. 运行 `scripts/setup_playwright_wsl.sh`

该脚本会：

1. 安装 Playwright/Chromium 运行时依赖（`libgbm1`、`libxkbcommon0` 等），避免 `Failed to launch browser`。
2. 在 `~/.config/qqbot/playwright-wsl.env` 写入常用环境变量：
   - `PLAYWRIGHT_CHROMIUM_EXTRA_ARGS="--disable-gpu --no-sandbox --disable-setuid-sandbox"`
   - `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`
   - 预留 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`，可指向宿主 Windows 的 Edge/Chrome。
3. 输出下一步操作提示。

```bash
chmod +x scripts/setup_playwright_wsl.sh
./scripts/setup_playwright_wsl.sh
echo 'source ~/.config/qqbot/playwright-wsl.env' >> ~/.bashrc
```

这样无论是 `npx playwright test` 还是 `npx @playwright/mcp …`，都会携带禁用沙箱的启动参数，避免 WSL 内核不支持 `user namespaces` 时直接退出。

## 2. 在 `/etc/wsl.conf` 启用 systemd 与 `vsyscall` 模拟

Chromium 在沙箱模式下依赖更完整的内核特性，微软官方 WSL2 允许通过 `wsl.conf` 打开：

```ini
[boot]
systemd=true

[wsl2]
kernelCommandLine = vsyscall=emulate
```

修改后执行 `wsl --shutdown` 并重新进入发行版，使 systemd、生效的内核参数帮助 Chromium 建立必要的命名空间（参考：MarkAI 关于 “Playwright MCP on WSL” 的排障建议）。

## 3. 安装 Playwright MCP Bridge 扩展并明确运行模式

GitHub issue [#990](https://github.com/microsoft/playwright-mcp/issues/990) 指出：在 WSL2 内启动 Codex + Playwright MCP 时，即使浏览器装了扩展，也可能出现 `Extension connection timeout`。实践中有两条路线：

### 方案 A：在 Windows 主机运行 MCP Server（推荐）

1. 在 Windows 的 Edge/Chrome 装好 “Playwright MCP Bridge”。
2. 打开一个浏览器标签页，保持登录状态。
3. 在 Windows Terminal/PowerShell 中运行：
   ```powershell
   uvx --from @playwright/mcp playwright-mcp --extension
   ```
4. 通过 VS Code Remote / SSH 连接到 WSL 开发目录，让 Codex 与该 MCP 服务通信。由于浏览器和 MCP Server 都在 Windows，扩展握手最稳定。

### 方案 B：继续在 WSL 内运行 MCP Server

1. 仍需在 Windows 浏览器安装扩展并保持打开。
2. 在 WSL 内运行：
   ```bash
   npx @playwright/mcp@latest --extension
   ```
3. 确认 Windows 上的扩展弹出 “Allow connection” 对话框；若无弹窗，多为防火墙或沙盒未禁用导致的崩溃，可重新执行第 1、2 步。
4. 如需复用 Windows 浏览器，可在 `playwright-wsl.env` 中配置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指向 `/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`。

## 4. 验证步骤

1. 启动 `npx @playwright/mcp --extension`（或 Windows 侧 uvx 命令）。
2. 在 Codex CLI 中执行一次 `browser_navigate` / `browser_click`。若成功，CLI 会显示浏览器可交互的可访问性快照。
3. 如果仍提示 “Extension connection timeout”，排查顺序：
   - Windows 浏览器是否真正加载了扩展，并弹出授权页。
   - WSL 中 `PLAYWRIGHT_CHROMIUM_EXTRA_ARGS` 是否生效：`printenv PLAYWRIGHT_CHROMIUM_EXTRA_ARGS`。
   - `wsl.conf` 修改后是否 `wsl --shutdown`。
   - 防火墙/杀毒软件是否拦截了 `http://127.0.0.1:9978`（MCP Bridge 默认端口）。

## 5. 常见问题速查

| 报错 | 处理 |
| --- | --- |
| `Failed to launch browser: Chromium sandboxing failed` | 再次运行脚本确保依赖齐全，并确认 `PLAYWRIGHT_CHROMIUM_EXTRA_ARGS` 包含 `--no-sandbox`。 |
| `Extension connection timeout` | 参照方案 A/B，确保扩展与 MCP server 在同一宿主环境中握手；必要时直接在 Windows 终端运行 MCP server。 |
| `spawn ... chrome: No such file or directory` | 运行 `npx playwright install chromium` 或配置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指向现有浏览器。 |
| `/dev/shm` 权限不足 | `sudo mount -t tmpfs -o size=1024M tmpfs /dev/shm`，或在 Docker/WSL 自启动脚本中加入该挂载。 |

通过以上配置，可在不离开 Codex CLI 的情况下，在 WSL2 环境中稳定复用 Windows 浏览器状态，解决原始报错给开发流程带来的阻塞。欢迎在本仓库或 GitHub issue 更新更多实践经验。
