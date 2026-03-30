import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const PATCH_TAG_START = '// [Glassy:START]';
const PATCH_TAG_END = '// [Glassy:END]';
const BACKUP_SUFFIX = '.glassy-backup';

/**
 * Injection for main.js (Electron main process).
 * Self-contained: reads config, watches for changes,
 * applies BrowserWindow.setOpacity(). No renderer patch or IPC needed.
 */
function getMainProcessInjection(configPath: string): string {
    const escaped = configPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    // main.js uses ESM — use dynamic import() which works anywhere in the file
    // fs.watchFile interval at 500ms to balance responsiveness and resource usage
    // Static imports are hoisted to module top — resolved BEFORE any code runs.
    // This means our browser-window-created listener registers before VS Code creates windows.
    // Use unique Glassy_ prefixes to avoid variable collision crashes if other patches exist.
    // Prime each window once at near-opaque opacity to avoid the first visible macOS flicker
    // when transitioning from fully opaque to transparent with setOpacity().
    return `
${PATCH_TAG_START}
import{app as Glassy_app,BrowserWindow as Glassy_BW}from"electron";import{readFileSync as Glassy_rf,existsSync as Glassy_ex,watchFile as Glassy_wf}from"fs";
;(()=>{try{const Glassy_cp='${escaped}';let Glassy_o=1;const Glassy_seen=new WeakSet(),Glassy_apply=w=>{try{if(!Glassy_seen.has(w)){Glassy_seen.add(w);if(Glassy_o>=1)w.setOpacity(.999)}w.setOpacity(Glassy_o)}catch(e){}};const Glassy_read=()=>{try{if(!Glassy_ex(Glassy_cp))return;const c=JSON.parse(Glassy_rf(Glassy_cp,"utf8"));if(typeof c.alpha==="number"&&c.alpha>=10&&c.alpha<=255)Glassy_o=c.alpha/255.0}catch(e){}};Glassy_read();Glassy_app.on("browser-window-created",(e,w)=>{Glassy_apply(w)});const Glassy_applyAll=()=>{Glassy_read();Glassy_BW.getAllWindows().forEach(Glassy_apply)};Glassy_app.whenReady().then(()=>{Glassy_applyAll();Glassy_wf(Glassy_cp,{interval:500},Glassy_applyAll)})}catch(e){}})();
${PATCH_TAG_END}`;
}

function getHomePath(): string {
    return os.homedir();
}

function getAppBasePath(): string {
    // Derive from running process — works for VS Code, Insiders, Cursor, any Electron fork
    const execPath = process.execPath;
    const contentsIdx = execPath.indexOf('/Contents/');
    if (contentsIdx !== -1) {
        const appResourcePath = path.join(execPath.substring(0, contentsIdx), 'Contents', 'Resources', 'app');
        if (fs.existsSync(path.join(appResourcePath, 'out', 'main.js'))) {
            return appResourcePath;
        }
    }

    // Fallback: check known locations
    const home = getHomePath();
    const candidates = [
        '/Applications/Visual Studio Code.app/Contents/Resources/app',
        '/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app',
        '/Applications/Cursor.app/Contents/Resources/app',
        '/Applications/VSCodium.app/Contents/Resources/app',
        '/Applications/Antigravity.app/Contents/Resources/app',
        '/Applications/Windsurf.app/Contents/Resources/app',
        path.join(home, 'Applications/Visual Studio Code.app/Contents/Resources/app'),
        path.join(home, 'Applications/Visual Studio Code - Insiders.app/Contents/Resources/app'),
        path.join(home, 'Applications/Cursor.app/Contents/Resources/app'),
        path.join(home, 'Applications/VSCodium.app/Contents/Resources/app'),
        path.join(home, 'Applications/Antigravity.app/Contents/Resources/app'),
        path.join(home, 'Applications/Windsurf.app/Contents/Resources/app'),
    ];

    for (const p of candidates) {
        if (fs.existsSync(path.join(p, 'out', 'main.js'))) {
            return p;
        }
    }

    throw new Error('Could not find VS Code installation.');
}

function getMainJsPath(): string {
    return path.join(getAppBasePath(), 'out', 'main.js');
}

function getPermissionDeniedMessage(mainPath: string): string {
    return [
        'Permission denied.',
        'Move VS Code to ~/Applications or grant write access only to your user, then try again.',
        `Example:\nsudo chown "$(whoami)" "${mainPath}" && chmod u+w "${mainPath}"`
    ].join('\n');
}

function isPermissionError(error: any): boolean {
    return error?.code === 'EACCES' || error?.code === 'EPERM';
}

export function getConfigPath(): string {
    return path.join(getHomePath(), '.glassy-config.json');
}

export function isPatched(): boolean {
    try {
        const content = fs.readFileSync(getMainJsPath(), 'utf8');
        const startIdx = content.indexOf(PATCH_TAG_START);
        if (startIdx === -1) return false;

        return content.indexOf(PATCH_TAG_END, startIdx + PATCH_TAG_START.length) !== -1;
    } catch {
        return false;
    }
}

export function installPatch(): { success: boolean; message: string } {
    let mainPath = '';
    try {
        mainPath = getMainJsPath();
        const backupPath = mainPath + BACKUP_SUFFIX;
        let content = fs.readFileSync(mainPath, 'utf8');
        let restoredFromBackup = false;

        // Remove old patch if present (loop protects against corrupted duplicates)
        while (content.includes(PATCH_TAG_START)) {
            const nextContent = removePatchFromContent(content);
            if (nextContent === content) {
                if (!restoredFromBackup && fs.existsSync(backupPath)) {
                    content = fs.readFileSync(backupPath, 'utf8');
                    restoredFromBackup = true;
                    continue;
                }

                return {
                    success: false,
                    message: 'Found a partial or malformed Glassy patch in VS Code. Restore the original file and try again.'
                };
            }
            content = nextContent;
        }

        // Save backup of the clean (unpatched) content
        fs.writeFileSync(backupPath, content, 'utf8');

        // Prepend injection — code must run BEFORE VS Code creates windows
        const configPath = getConfigPath();
        content = getMainProcessInjection(configPath) + '\n' + content;
        fs.writeFileSync(mainPath, content, 'utf8');

        return { success: true, message: 'Patch installed successfully.' };
    } catch (e: any) {
        if (isPermissionError(e)) {
            return {
                success: false,
                message: getPermissionDeniedMessage(mainPath || getMainJsPath())
            };
        }
        return { success: false, message: e.message };
    }
}

export function uninstallPatch(): { success: boolean; message: string } {
    let mainPath = '';
    try {
        mainPath = getMainJsPath();
        const backupPath = mainPath + BACKUP_SUFFIX;

        // Always prefer stripping by tags — safe across VS Code updates
        let content = fs.readFileSync(mainPath, 'utf8');
        let didRemove = false;
        while (content.includes(PATCH_TAG_START)) {
            const nextContent = removePatchFromContent(content);
            if (nextContent === content) {
                if (fs.existsSync(backupPath)) {
                    fs.copyFileSync(backupPath, mainPath);
                    fs.unlinkSync(backupPath);
                    return { success: true, message: 'Patch removed (restored from backup).' };
                }

                return {
                    success: false,
                    message: 'Found a partial or malformed Glassy patch in VS Code. Restore the original file and try again.'
                };
            }
            content = nextContent;
            didRemove = true;
        }

        if (didRemove) {
            fs.writeFileSync(mainPath, content, 'utf8');
            // Clean up backup if it exists
            try { fs.unlinkSync(backupPath); } catch {}
            return { success: true, message: 'Patch removed.' };
        }

        // If tags are gone but a backup remains, treat it as stale and remove it
        if (fs.existsSync(backupPath)) {
            fs.unlinkSync(backupPath);
            return { success: true, message: 'No patch found. Removed stale Glassy backup.' };
        }

        return { success: true, message: 'No patch found.' };
    } catch (e: any) {
        if (isPermissionError(e)) {
            return {
                success: false,
                message: getPermissionDeniedMessage(mainPath || getMainJsPath())
            };
        }
        return { success: false, message: e.message };
    }
}

function removePatchFromContent(content: string): string {
    const startIdx = content.indexOf(PATCH_TAG_START);
    if (startIdx === -1) return content;

    const endIdx = content.indexOf(PATCH_TAG_END, startIdx + PATCH_TAG_START.length);
    if (endIdx === -1) return content;

    const removeStart = startIdx === 0 ? 0 : content.lastIndexOf('\n', startIdx);
    let removeEnd = endIdx + PATCH_TAG_END.length;
    // Also strip the newline after the patch
    if (content[removeEnd] === '\n') removeEnd++;
    return content.substring(0, removeStart >= 0 ? removeStart : 0) + content.substring(removeEnd);
}

/** Atomic write — write to temp file then rename to avoid corruption from concurrent writes */
export function writeConfig(alpha: number): void {
    const configPath = getConfigPath();
    const tmpPath = configPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify({ alpha }), 'utf8');

    try {
        fs.renameSync(tmpPath, configPath);
    } catch (e: any) {
        if (e.code === 'EXDEV') {
            fs.copyFileSync(tmpPath, configPath);
            fs.unlinkSync(tmpPath);
            return;
        }

        try { fs.unlinkSync(tmpPath); } catch {}
        throw e;
    }
}

export function removeConfig(): void {
    try { fs.unlinkSync(getConfigPath()); } catch {}
    try { fs.unlinkSync(getConfigPath() + '.tmp'); } catch {}
}
