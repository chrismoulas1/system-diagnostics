'use strict';
// Cross-platform dev launcher.
// Spawns the API server and Vite dev server directly via node so that no
// shell (cmd.exe / sh) is required.  This avoids the "spawn cmd.exe ENOENT"
// error that occurs in Git Bash and similar environments on Windows.
const { spawn } = require('child_process');
const path = require('path');

const viteBin = path.join('node_modules', 'vite', 'bin', 'vite.js');

const commands = [
  { label: 'server', args: ['server.js'] },
  { label: 'vite',   args: [viteBin, '--port', '5000', '--host', '0.0.0.0'] },
];

const procs = commands.map(({ label, args }) => {
  const proc = spawn(process.execPath, args, { stdio: 'inherit' });

  proc.on('close', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[${label}] exited with code ${code}`);
    }
    // If either child exits, stop the other one too.
    cleanup();
  });

  return proc;
});

function cleanup() {
  procs.forEach((p) => {
    try { p.kill(); } catch (_) { /* already gone */ }
  });
}

process.on('SIGINT',  cleanup);
process.on('SIGTERM', cleanup);
