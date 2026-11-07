// Launches the desktop app. Some terminals (e.g. VS Code's) set ELECTRON_RUN_AS_NODE, which makes
// Electron behave like plain Node; it is removed here so the window always opens.
import { spawn } from 'node:child_process';
import electronPath from 'electron';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electronPath, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
