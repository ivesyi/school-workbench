# Toolchain Baseline

The frozen development target is Node.js 24 and pnpm 11. The repository records this through `.node-version`, `package.json#engines`, and `packageManager`.

The initial scaffold was created on 2026-08-17 with system Node.js 26.7.0, pnpm 11.19.0, and Codex CLI 0.147.0. Node 26 is used only to bootstrap and verify compatibility in the current workstation; it does not change the Node 24 product baseline. CI and release builds must use the recorded Node 24 version.

DeepSeek Harness is not a Foundation-phase dependency and is intentionally absent.
