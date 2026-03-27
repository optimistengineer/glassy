# Publishing Glassy

This document outlines the standard procedure for publishing new versions of the **Glassy** extension.

Because the extension supports both official VS Code and third-party forks (like Cursor, VSCodium, Antigravity), we publish to two separate registries:
1. **VS Code Marketplace** (via `vsce`)
2. **Open VSX Registry** (via `ovsx`)

---

## 🚀 Step-by-Step Release Flow

### 1. Update the Version
Bump the version number in `package.json` to the new target version:
```json
"version": "0.x.x"
```

### 2. Update the Changelog
Add the release notes for the new version to `CHANGELOG.md` at the top of the file:
```markdown
## 0.x.x

- Describe the new features, fixes, or improvements here.
```

### 3. Commit and Push
Commit the version bump and changelog updates so the GitHub repository is up to date:
```bash
git add package.json CHANGELOG.md
git commit -m "chore: bump version to 0.x.x and update changelog"
git push
```

### 4. Publish to VS Code Marketplace
Make sure you are logged in to `vsce` with your Personal Access Token. Then, run:
```bash
npx @vscode/vsce publish
```
This command automatically runs the compile script, packages the `.vsix` bundle, and pushes it to Microsoft's marketplace.

### 5. Publish to Open VSX Registry (Cursor, Antigravity, VSCodium)
In order for users of alternative editors to find updates, publish the bundle to the Eclipse Foundation's registry.

You will need your Open VSX access token. If you haven't yet, make sure you've signed the Publisher Agreement at [open-vsx.org](https://open-vsx.org/).

Run the publish command using your token:
```bash
npx ovsx publish -p <your_open_vsx_token>
```
*(If this is your first time publishing on a new machine, ensure your namespace is created using `npx ovsx create-namespace optimistengineer -p <token>` before publishing).*

---

## 📝 Convenience Script (Optional)
If you prefer, you can combine these into a single step during future updates:
```bash
git add . && git commit -m "chore: release 0.x.x" && git push && npx @vscode/vsce publish && npx ovsx publish -p <your_open_vsx_token>
```
