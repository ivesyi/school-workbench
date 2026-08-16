# ADR-001: Electron Desktop Application

**状态：Accepted**  
**日期：2026-08-17**  
**适用版本：Workbench V0.1+**

## Context

School Workbench 是单用户、Local-first 的顾问工具。它必须访问本地 SQLite、文件和录音，启动并控制 ACP Agent Runtime，通过 stdio 提供 MCP，调用系统已有的 Codex、DeepSeek Harness 与 `lark-cli`，并在飞书授权后恢复原 Agent Run。

虽然主要界面适合使用 Web UI 技术，但浏览器本身无法可靠承担本地子进程、文件系统、数据库和应用生命周期管理。如果采用普通 Web App，就必须额外安装本地 Daemon，并处理浏览器与 Daemon 之间的身份、端口、启动、升级及故障恢复，违背 Zero-Maintenance UX。

## Decision

产品正式采用：

> **Electron 桌面客户端，React Web UI 运行在 Renderer 中。**

进程边界：

```text
Renderer
React / Experience UI
        │
        │ typed IPC
        ▼
Preload
        │
        ▼
Electron Main
Domain / Assessment / SQLite / Agent Host / File Service
        │
        ├── ACP Runtime
        ├── MCP stdio
        ├── lark-cli
        └── system default browser
```

Renderer 不直接访问 SQLite、filesystem、child process、Token 或 Runtime。第三方授权使用系统默认浏览器，Electron 只显示授权状态和二维码，不承载飞书登录页面。

## Frozen Stack

```text
Electron 43.x
React 19
TypeScript 5
Node 24
electron-vite / Vite
pnpm
```

## Alternatives Considered

### Browser-hosted Web App

拒绝。仍需本地 Daemon，增加安装、连接、权限和故障边界，且不适合离线状态管理。

### Local Web Server + System Browser

拒绝作为主要产品形态。浏览器关闭、端口冲突、文件权限和后台进程可见性都会增加维护成本。

### Tauri

暂不采用。其包体更小，但会引入 Rust 运行边界；当前 Agent、ACP、MCP、Electron UI 和 CLI 生态主要是 TypeScript / Node，Electron 能更快复用成熟实现。

### Native macOS Application

拒绝。开发成本高，且会降低未来跨平台能力，与现有 TypeScript Agent 生态不匹配。

## Consequences

- 用户获得一个可安装、可启动、无需单独维护服务的客户端。
- 所有正式业务数据保留在本机。
- React 仍可按 Web UI 方式开发和测试。
- Electron Main 成为高权限边界，必须使用 typed IPC、最小权限 Token 和严格输入验证。
- 后续如需远程协作，应新增明确的同步架构，不把本地 API 直接暴露到网络。

## Revisit Conditions

只有出现以下真实需求时重新评估：

- 多用户实时协作成为核心能力；
- 需要无安装的跨设备访问；
- 本地 Agent Runtime 可以被可信远程服务完全替代；
- Electron 无法满足目标平台的安全或分发要求。
