import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(npm, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${args.join(' ')} exited with ${code}`));
    });
  });
}

function start(args) {
  const child = spawn(npm, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  child.on('exit', (code) => {
    if (code && code !== 0) process.exitCode = code;
  });
  return child;
}

await run(['run', 'export-plan']);
const api = start(['run', 'start:api']);
const web = start(['run', 'start:web']);

function stop() {
  api.kill();
  web.kill();
}

process.on('SIGINT', () => {
  stop();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stop();
  process.exit(0);
});
