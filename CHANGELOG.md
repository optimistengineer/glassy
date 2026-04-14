# Changelog

## 0.1.6

- Fixed extension icon not displaying on Open VSX and compatible editors (Cursor, VSCodium, Antigravity, Windsurf)

## 0.1.5

- Significantly reduced extension `.vsix` bundle size by optimizing the logo asset
- Added an embedded auto-playing live demo video to the README and documentation site

## 0.1.4

- Added `glassy.autoRestartAfterUpdate` setting to automatically restart VS Code after an update without prompting
- Added "Glassy: Toggle Auto-Restart on Update" command to the Command Palette

## 0.1.3

- Added Windsurf editor support
- Redesigned install stats chart with adaptive light/dark theme
- Fixed preview images not rendering on Open VSX and VS Code Marketplace
- Added GitHub Pages landing page
- Consolidated resources into assets folder
- Switched install tracking to use Marketplace downloadCount metric

## 0.1.2

- Added explicit support for the Antigravity editor

## 0.1.1

- Improved installation flow to apply transparency patches immediately
- Added auto-restart prompt for a smoother onboarding experience
- Fixed stability issues related to restart handling

## 0.1.0

- Initial release
- Window transparency control via keyboard shortcuts
- Configurable opacity level and step size
- macOS Tahoe (26.x) support via Electron BrowserWindow API
- Enable/Disable commands for safe patch management
