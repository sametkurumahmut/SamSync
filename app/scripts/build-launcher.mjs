// Compiles resources/launcher/SamSyncSend.c (the small program the Explorer menu starts) with the Visual C++
// compiler into out/launcher/SamSyncSend.exe, where electron-builder picks it up. Without the compiler the
// package is built without it and the menus start SamSync.exe itself, as they always did.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'resources', 'launcher', 'SamSyncSend.c');
const outDir = path.join(root, 'out', 'launcher');
const exe = path.join(outDir, 'SamSyncSend.exe');

/** vcvars64.bat of the newest Visual Studio or Build Tools, through vswhere. */
function vcvars() {
  const vswhere = path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  if (!fs.existsSync(vswhere)) return null;
  try {
    const dir = execFileSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8' }).trim();
    const bat = path.join(dir, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
    return fs.existsSync(bat) ? bat : null;
  } catch {
    return null;
  }
}

export function buildLauncher() {
  if (process.platform !== 'win32') return false;
  fs.rmSync(exe, { force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const bat = vcvars();
  if (!bat) {
    console.warn('Visual C++ bulunamadı: SamSyncSend.exe derlenmedi, menüler SamSync.exe ile çalışacak.');
    return false;
  }
  // the object file lands in the working folder (outDir)
  const cl = ['cl', '/nologo', '/O1', '/W4', '/MT', `"${src}"`, `/Fe:"${exe}"`, '/link', '/SUBSYSTEM:WINDOWS', '/ENTRY:wWinMainCRTStartup', 'shell32.lib', 'advapi32.lib'].join(' ');
  const r = spawnSync('cmd.exe', ['/d', '/s', '/c', `"call "${bat}" >nul 2>&1 && ${cl}"`], { cwd: outDir, stdio: 'inherit', windowsVerbatimArguments: true });
  if (r.status !== 0 || !fs.existsSync(exe)) {
    console.warn('SamSyncSend.exe derlenemedi; menüler SamSync.exe ile çalışacak.');
    return false;
  }
  console.log(`SamSyncSend.exe: ${fs.statSync(exe).size} bayt`);
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) buildLauncher();
