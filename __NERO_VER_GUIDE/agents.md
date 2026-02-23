# OpenCode Auto-Update Agent Instructions

Dear AI Agent,

When the user asks you to "check for new OpenCode versions", "download the latest OpenCode", or "update OpenCode", your task is to safely pull the upstream changes and re-apply our custom clipboard/mouse tracking hacks. 

**DO NOT simply pull and build blindly!** You must preserve the custom UI modifications located in this directory.

Follow this exact procedure:

## 1. Safety Checks & Pulling Upstream
1. Navigate to `/workspace/purrnet/opencode`.
2. Inspect the current state (`git status`, `git branch`). Ensure working tree is clean or stash changes if necessary.
3. Check the upstream `main` branch. 
4. Fetch and pull the latest changes from `origin main`.
   \`\`\`bash
   git fetch origin
   git merge origin/main
   \`\`\`

## 2. Re-applying the Custom Hacks
We have a critical patch that disables `opentui` mouse capturing and explicitly routes WSL clipboard output to `clip.exe`.
1. Apply the patch:
   \`\`\`bash
   git apply /workspace/purrnet/opencode/__NERO_VER_GUIDE/2026-02-21-mouse-clipboard-wsl-hack.patch
   \`\`\`
2. **Handle Conflicts**: If the patch fails to apply cleanly (because upstream refactored `app.tsx` or `clipboard.ts`), **DO NOT PANIC**. 
   - Read the `.patch` file.
   - Manually re-implement the two changes:
     a) Disabling mouse tracking in `app.tsx` (`process.stdout.write` interceptor removing `\x1b[?1003h` etc).
     b) Priority for `clip.exe` on `WSL` inside `clipboard.ts` (`if (release().includes("WSL") && Bun.which("clip.exe"))`).

## 3. Building the Executable
1. Check the new version string from `package.json`.
2. Ensure you append `n` to the version (e.g., `1.2.8n`) so the user can verify our build.
   \`\`\`bash
   export OPENCODE_VERSION="<new-version>n"
   export OPENCODE_RELEASE=""  # CRITICAL: Keep empty to avoid zip/tar GitHub release failures
   bun run ./packages/opencode/script/build.ts --single
   \`\`\`

## 4. System Deployment
1. Replace the currently installed binary. Note: Do this safely by making sure the build succeeded first.
   \`\`\`bash
   sudo rm -f /usr/bin/opencode
   sudo cp packages/opencode/dist/opencode-linux-x64/bin/opencode /usr/bin/opencode
   sudo chmod +x /usr/bin/opencode
   \`\`\`

## 5. Report to User
1. Verify the newly installed binary works by running `opencode --version`.
2. Tell the user to restart their tmux session or run `opencode` again, and remind them that the new version in the corner should have an 'n' on it.
