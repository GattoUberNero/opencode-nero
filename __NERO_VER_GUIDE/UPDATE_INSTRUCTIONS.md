# OpenCode Custom Update Guide (WSL & Mouse Hack)

This guide explains how to update OpenCode from upstream while keeping the custom modifications that enable native mouse text selection and clipboard integration within tmux on WSL2.

## Problem Solved by the Patch
- **Terminal Mouse Capture**: `@opentui` aggressively captured mouse events via ANSI sequences (`\x1b[?1003h`, etc.), preventing native terminal text selection. The patch intercepts `stdout.write` in the TUI app to drop these sequences.
- **WSL Clipboard bridging**: By default, `xclip` in WSL only writes to the internal Linux X11 clipboard, which fails to reach Windows. The patch configures `Clipboard.copy` to use `clip.exe` when WSL is detected, bridging directly to the Windows host clipboard.
- **Release Build Override**: Bypassed the requirement to create `.zip` release archives during local builds.

---

## How to Update OpenCode

Whenever you want to pull the latest upstream changes from the `opencode-ai` repository, follow these steps:

### 1. Fetch Upstream Changes
Run these commands in the `opencode` project root (`/workspace/purrnet/opencode`):
```bash
git fetch origin
git checkout main
git pull
```

### 2. Apply the Custom Patch
Apply the saved patch to re-inject the mouse and clipboard hacks into the latest code:
```bash
git apply __NERO_VER_GUIDE/2026-02-21-mouse-clipboard-wsl-hack.patch
```

*(Note: If the patch fails to apply because upstream radically changed `app.tsx` or `clipboard.ts`, you will need to manually re-implement the `stdout.write` ANSI interceptor and the `clip.exe` priority check based on the patch file contents).*

### 3. Build the Standalone Executable
Set the desired custom version (e.g., append `n` to distinguish it from official builds) and compile:
```bash
export OPENCODE_VERSION=1.2.x.n  # Replace X with the actual latest version
export OPENCODE_RELEASE=
bun run ./packages/opencode/script/build.ts --single
```

### 4. Deploy to the System
Replace the global executable with the newly built binary:
```bash
sudo rm -f /usr/bin/opencode
sudo cp packages/opencode/dist/opencode-linux-x64/bin/opencode /usr/bin/opencode
sudo chmod +x /usr/bin/opencode
```

**Done!** Restart your tmux session or terminal to use the newly built OpenCode with your custom hacks intact.
