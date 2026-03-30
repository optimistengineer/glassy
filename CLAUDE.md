# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Glassy is a VS Code extension for macOS that enables adjustable window transparency. It works by patching VS Code's Electron main process (`out/main.js`) to inject opacity control code before windows are created.

## Commands

```bash
npm run compile          # Production build (minified, no sourcemaps)
npm run watch            # Development watch mode (sourcemaps enabled)
npm run package          # Package as .vsix for local testing
```

There are no tests or linter configured — the TypeScript compiler serves as the primary static check.

## Architecture

The extension has two main source files:

### `src/extension.ts`
Runs in VS Code's extension host process. Handles all user-facing behavior:
- Registers 6 commands (`glassy.install`, `glassy.uninstall`, `glassy.increase`, `glassy.decrease`, `glassy.maximize`, `glassy.minimize`)
- Manages status bar, settings sync, debounced opacity writes (50ms), and auto-repair after VS Code updates
- Writes opacity to both VS Code settings (`glassy.alpha`) and `~/.glassy-config.json`

### `src/patcher.ts`
Handles the actual file patching of VS Code internals:
- Locates VS Code's `out/main.js` across supported editors (VS Code, Insiders, Cursor, VSCodium, Antigravity, Windsurf)
- Prepends minified Electron code wrapped in `PATCH_TAG_START`/`PATCH_TAG_END` markers to `main.js`
- The injected code calls `BrowserWindow.setOpacity()` and watches `~/.glassy-config.json` with 500ms polling
- Uses atomic writes (temp file + rename) for `~/.glassy-config.json` to prevent corruption
- Backs up original `main.js` before patching; restore on uninstall

### Build

`esbuild.js` bundles `src/extension.ts` → `dist/extension.js` as CommonJS with `vscode` externalized. No other runtime dependencies.

## Publishing

Dual-registry workflow documented in `PUBLISHING.md`:
1. Bump version in `package.json`, update `CHANGELOG.md`, commit and push
2. `npx @vscode/vsce publish` → VS Code Marketplace
3. `npx ovsx publish -p <token>` → Open VSX (for Cursor, VSCodium, Antigravity users)
