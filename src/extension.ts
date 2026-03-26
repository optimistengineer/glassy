import * as vscode from 'vscode';
import { installPatch, uninstallPatch, isPatched, writeConfig, removeConfig } from './patcher';

const ENABLED_KEY = 'glassy.enabled';
const PROMPT_SHOWN_KEY = 'glassy.promptShown';
const MIN_ALPHA = 10; // Safety: prevent completely invisible windows
const DEFAULT_ALPHA = 240;
const DEFAULT_STEP = 4;

let currentAlpha: number = DEFAULT_ALPHA;
let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let lastConfigWriteError: string | undefined;
let extensionIsActive = false;
const expectedConfigAlphaEvents = new Map<number, number>();
let settingsSyncInFlight = false;
let pendingSettingsAlpha: number | undefined;

function clampAlpha(alpha: number): number {
    return Math.max(MIN_ALPHA, Math.min(255, Math.round(alpha)));
}

function getAppPath(): string {
    // Derive from running process — works for VS Code, Insiders, Cursor, any fork
    const execPath = process.execPath;
    const contentsIdx = execPath.indexOf('/Contents/');
    if (contentsIdx !== -1) {
        return execPath.substring(0, contentsIdx);
    }
    return '';
}

function safeAppendLine(message: string) {
    if (!extensionIsActive || !outputChannel) return;

    try {
        outputChannel.appendLine(message);
    } catch {
        // Ignore logging failures during shutdown/disposal.
    }
}

function writeConfigSafe(alpha: number, reason: string): boolean {
    try {
        writeConfig(alpha);
        lastConfigWriteError = undefined;
        return true;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        safeAppendLine(`Failed to write opacity config during ${reason}: ${message}`);

        if (lastConfigWriteError !== message) {
            lastConfigWriteError = message;
            void vscode.window.showErrorMessage(`Glassy: Failed to update opacity config — ${message}`);
        }

        return false;
    }
}

function flushPendingAlphaWrite() {
    if (!debounceTimer) return;

    clearTimeout(debounceTimer);
    debounceTimer = undefined;

    if (isPatched() && writeConfigSafe(currentAlpha, 'shutdown')) {
        safeAppendLine(`Flushed alpha=${currentAlpha}`);
    }
}

function adjustExpectedConfigAlphaEvent(alpha: number, delta: 1 | -1) {
    const nextCount = (expectedConfigAlphaEvents.get(alpha) ?? 0) + delta;

    if (nextCount > 0) {
        expectedConfigAlphaEvents.set(alpha, nextCount);
    } else {
        expectedConfigAlphaEvents.delete(alpha);
    }
}

function rememberExpectedConfigAlphaEvent(alpha: number): () => void {
    let settled = false;

    adjustExpectedConfigAlphaEvent(alpha, 1);

    const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        adjustExpectedConfigAlphaEvent(alpha, -1);
    }, 5000);

    return () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        adjustExpectedConfigAlphaEvent(alpha, -1);
    };
}

function consumeExpectedConfigAlphaEvent(alpha: number): boolean {
    const count = expectedConfigAlphaEvents.get(alpha) ?? 0;
    if (count <= 0) return false;

    adjustExpectedConfigAlphaEvent(alpha, -1);
    return true;
}

function scheduleAlphaSettingSync(alpha: number) {
    pendingSettingsAlpha = alpha;
    if (settingsSyncInFlight) return;

    settingsSyncInFlight = true;

    void (async () => {
        while (pendingSettingsAlpha !== undefined) {
            const nextAlpha = pendingSettingsAlpha;
            pendingSettingsAlpha = undefined;
            const clearExpectedConfigEvent = rememberExpectedConfigAlphaEvent(nextAlpha);

            try {
                await vscode.workspace
                    .getConfiguration('glassy')
                    .update('alpha', nextAlpha, vscode.ConfigurationTarget.Global);
            } catch (error) {
                clearExpectedConfigEvent();
                safeAppendLine(
                    `Failed to persist alpha setting: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        settingsSyncInFlight = false;
    })();
}

async function restartVSCode(): Promise<boolean> {
    flushPendingAlphaWrite();

    const appPath = getAppPath();
    const rawPid = process.env.VSCODE_PID;
    const pid = rawPid && /^\d+$/.test(rawPid) ? rawPid : undefined;

    if (!appPath) {
        await vscode.window.showWarningMessage(
            'Glassy could not determine the current app bundle. Please quit and reopen it manually.'
        );
        return false;
    }

    if (rawPid && !pid) {
        safeAppendLine('Ignoring invalid VSCODE_PID value during restart.');
    }

    const { spawn } = require('child_process') as typeof import('child_process');
    const escapedAppPath = appPath.replace(/'/g, "'\\''");
    const openCmd = `open '${escapedAppPath}'`;
    let script = '';

    if (pid) {
        // Reopen only after the current process exits to avoid duplicate instances.
        script = `i=0; while [ $i -lt 30 ]; do if ! kill -0 ${pid} 2>/dev/null; then ${openCmd}; exit 0; fi; sleep 0.5; i=$((i+1)); done; osascript -e 'display notification "Please reopen VS Code manually to finish applying Glassy." with title "Glassy"'`;
    } else {
        script = `sleep 2 && ${openCmd}`;
    }

    try {
        const child = spawn('sh', ['-c', script], {
            detached: true,
            stdio: 'ignore'
        });
        child.unref();
        await vscode.commands.executeCommand('workbench.action.quit');
        return true;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        safeAppendLine(`Failed to schedule restart: ${message}`);
        await vscode.window.showErrorMessage(
            'Glassy: Failed to restart automatically. Please quit and reopen it manually.'
        );
        return false;
    }
}

function updateStatusBar() {
    if (!statusBarItem) return;
    if (currentAlpha >= 255) {
        statusBarItem.text = '$(eye) 100%';
        statusBarItem.tooltip = 'Glassy: Fully opaque (click to make it transparent)';
        statusBarItem.command = 'glassy.decrease';
    } else {
        const pct = Math.round((currentAlpha / 255) * 100);
        statusBarItem.text = `$(eye-closed) ${pct}%`;
        statusBarItem.tooltip = `Glassy: ${pct}% opacity (click to reset to opaque)`;
        statusBarItem.command = 'glassy.minimize';
    }
    statusBarItem.show();
}

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('Glassy');
    extensionIsActive = true;
    context.subscriptions.push(outputChannel);

    if (process.platform !== 'darwin') {
        const unsupportedCommand = async () => {
            await vscode.window.showWarningMessage('Glassy only works on macOS.');
        };

        context.subscriptions.push(
            vscode.commands.registerCommand('glassy.install', unsupportedCommand),
            vscode.commands.registerCommand('glassy.uninstall', unsupportedCommand),
            vscode.commands.registerCommand('glassy.increase', unsupportedCommand),
            vscode.commands.registerCommand('glassy.decrease', unsupportedCommand),
            vscode.commands.registerCommand('glassy.maximize', unsupportedCommand),
            vscode.commands.registerCommand('glassy.minimize', unsupportedCommand)
        );

        void unsupportedCommand();
        return;
    }

    // Status bar
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    context.subscriptions.push(statusBarItem);

    const patched = isPatched();
    const userEnabled = context.globalState.get<boolean>(ENABLED_KEY, false);
    safeAppendLine(`Patch: ${patched ? 'installed' : 'not installed'}, User opted in: ${userEnabled}`);

    currentAlpha = clampAlpha(
        vscode.workspace.getConfiguration('glassy').get<number>('alpha', DEFAULT_ALPHA)
    );

    // Auto-re-patch after VS Code update
    if (userEnabled && !patched) {
        safeAppendLine('Patch missing (VS Code likely updated). Re-applying...');
        const result = installPatch();
        safeAppendLine(`Re-patch: ${result.message}`);

        if (result.success) {
            writeConfigSafe(currentAlpha, 'post-update repatch');
            vscode.window.showInformationMessage(
                'Glassy: VS Code was updated. Patch re-applied. A restart is required for window transparency.',
                'Restart Now', 'Later'
            ).then(choice => {
                if (choice === 'Restart Now') {
                    void restartVSCode();
                }
            });
        } else {
            vscode.window.showErrorMessage(`Glassy: Failed to re-apply patch after update — ${result.message}`);
        }
    } else if (patched && currentAlpha < 255) {
        writeConfigSafe(currentAlpha, 'startup restore');
    }

    if (patched) {
        updateStatusBar();
    }

    // --- Install/Uninstall commands ---
    context.subscriptions.push(
        vscode.commands.registerCommand('glassy.install', async () => {
            if (isPatched()) {
                if (!context.globalState.get<boolean>(ENABLED_KEY, false)) {
                    await context.globalState.update(ENABLED_KEY, true);
                }
                updateStatusBar();
                vscode.window.showInformationMessage('Glassy: Transparency is already enabled.');
                return;
            }

            const result = installPatch();
            safeAppendLine(`Install: ${result.message}`);

            if (result.success) {
                await context.globalState.update(ENABLED_KEY, true);
                writeConfigSafe(currentAlpha, 'install');
                const choice = await vscode.window.showInformationMessage(
                    'Glassy installed! VS Code needs to restart for transparency to take effect.',
                    'Restart Now', 'Later'
                );
                if (choice === 'Restart Now') {
                    await restartVSCode();
                }
            } else {
                vscode.window.showErrorMessage(`Glassy: ${result.message}`);
            }
        }),

        vscode.commands.registerCommand('glassy.uninstall', async () => {
            const result = uninstallPatch();
            safeAppendLine(`Uninstall: ${result.message}`);

            if (result.success) {
                removeConfig();
                await context.globalState.update(ENABLED_KEY, false);
                statusBarItem.hide();
                const choice = await vscode.window.showInformationMessage(
                    'Glassy removed. VS Code needs to restart to restore full opacity.',
                    'Restart Now', 'Later'
                );
                if (choice === 'Restart Now') {
                    await restartVSCode();
                }
            } else {
                vscode.window.showErrorMessage(`Glassy: ${result.message}`);
            }
        })
    );

    // --- Opacity commands ---
    context.subscriptions.push(
        vscode.commands.registerCommand('glassy.increase', () => {
            const step = vscode.workspace.getConfiguration('glassy').get<number>('step', DEFAULT_STEP);
            currentAlpha = clampAlpha(currentAlpha + step);
            applyAlpha();
        }),
        vscode.commands.registerCommand('glassy.decrease', () => {
            const step = vscode.workspace.getConfiguration('glassy').get<number>('step', DEFAULT_STEP);
            currentAlpha = clampAlpha(currentAlpha - step);
            applyAlpha();
        }),
        vscode.commands.registerCommand('glassy.maximize', () => {
            currentAlpha = MIN_ALPHA;
            applyAlpha();
        }),
        vscode.commands.registerCommand('glassy.minimize', () => {
            currentAlpha = 255;
            applyAlpha();
        })
    );

    // Config changes from Settings UI only
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('glassy.alpha')) {
                const newAlpha = clampAlpha(
                    vscode.workspace.getConfiguration('glassy').get<number>('alpha', DEFAULT_ALPHA)
                );

                if (consumeExpectedConfigAlphaEvent(newAlpha)) {
                    return;
                }

                if (newAlpha !== currentAlpha) {
                    currentAlpha = newAlpha;

                    if (!isPatched()) {
                        statusBarItem.hide();
                        safeAppendLine(
                            `Settings changed: alpha=${currentAlpha} (will apply after enabling Glassy)`
                        );
                        return;
                    }

                    if (writeConfigSafe(currentAlpha, 'settings change')) {
                        updateStatusBar();
                        safeAppendLine(`Settings changed: alpha=${currentAlpha}`);
                    }
                }
            }
        })
    );

    // First-time prompt
    if (!patched && !userEnabled && !context.globalState.get<boolean>(PROMPT_SHOWN_KEY, false)) {
        void context.globalState.update(PROMPT_SHOWN_KEY, true);

        vscode.window.showInformationMessage(
            'Glassy: Run "Glassy: Enable Transparency" to set up window transparency.',
            'Enable Now'
        ).then(choice => {
            if (choice === 'Enable Now') {
                void vscode.commands.executeCommand('glassy.install');
            }
        });
    }
}

function applyAlpha() {
    if (!isPatched()) {
        statusBarItem.hide();
        vscode.window.showWarningMessage(
            'Glassy: Patch not installed. Run "Glassy: Enable Transparency" first.',
            'Enable Now'
        ).then(choice => {
            if (choice === 'Enable Now') {
                void vscode.commands.executeCommand('glassy.install');
            }
        });
        return;
    }

    // Debounce rapid key presses — write config at most every 50ms
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        debounceTimer = undefined;

        if (writeConfigSafe(currentAlpha, 'opacity update')) {
            safeAppendLine(`Applied alpha=${currentAlpha}`);
        }
    }, 50);

    updateStatusBar();

    // Persist to settings without triggering the config listener
    scheduleAlphaSettingSync(currentAlpha);
}

export function deactivate() {
    // Don't reset opacity on deactivate — the config file should persist
    // the user's chosen alpha so the next startup is transparent immediately.
    // Opacity is only reset to 255 when user runs "Disable Transparency".
    flushPendingAlphaWrite();
    extensionIsActive = false;
}
