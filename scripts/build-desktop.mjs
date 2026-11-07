// Builds the desktop installers: `node scripts/build-desktop.mjs mac|win [--signed]`
//  - mac:  AcrobatDesk-<version>-mac-arm64.dmg and -mac-x64.dmg
//  - win:  AcrobatDesk-<version>-windows-x64-setup.exe
// Without --signed, macOS builds are ad-hoc signed (fine for internal use; see DESKTOP.md).
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [target = process.platform === 'darwin' ? 'mac' : 'win', ...flags] = process.argv.slice(2);
const signed = flags.includes('--signed');

// electron-builder rejects output folders whose path contains shell-special characters
// (this project folder's name contains "&"), so fall back to ~/AcrobatDesk-release then.
const unsafe = /[&;|$`'"<>(){}!*?\[\]]/.test(root);
const output = unsafe ? join(homedir(), 'AcrobatDesk-release') : join(root, 'release');

const args = ['electron-builder', `--${target}`, `-c.directories.output=${output}`];
if (target === 'mac' && !signed) args.push('-c.mac.identity=-', '-c.mac.hardenedRuntime=false');
// Signed macOS builds are also notarized (needs APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID)
if (target === 'mac' && signed) args.push('-c.mac.notarize=true');

const run = (cmd, a) => {
  const r = spawnSync(cmd, a, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run('npm', ['run', 'build']);
run('npx', args);
console.log(`\nInstallers written to: ${output}`);
