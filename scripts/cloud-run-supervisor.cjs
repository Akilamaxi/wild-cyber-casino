'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const root = '/app/apps';
const gatewayPort = process.env.PORT || '8080';
const services = [
  { name: 'backoffice-api', port: '5001' },
  { name: 'loyalty-engine', port: '5002' },
  { name: 'payout-worker' },
  { name: 'lottery-engine', port: gatewayPort, gateway: true },
];

const children = new Map();
let stopping = false;

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children.values()) {
    if (!child.killed) child.kill('SIGTERM');
  }
  const timer = setTimeout(() => {
    for (const child of children.values()) {
      if (!child.killed) child.kill('SIGKILL');
    }
    process.exit(exitCode);
  }, 9000);
  timer.unref();
  Promise.allSettled([...children.values()].map(child => new Promise(resolve => child.once('exit', resolve))))
    .finally(() => process.exit(exitCode));
}

for (const service of services) {
  const cwd = path.join(root, service.name);
  const env = {
    ...process.env,
    ...(service.port ? { PORT: service.port } : {}),
    RUN_WORKER_CONCURRENTLY: 'false',
    BACKOFFICE_URL: process.env.BACKOFFICE_URL || 'http://127.0.0.1:5001',
    LOYALTY_URL: process.env.LOYALTY_URL || 'http://127.0.0.1:5002',
  };
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd,
    env,
    stdio: 'inherit',
  });
  children.set(service.name, child);
  child.once('exit', (code, signal) => {
    if (stopping) return;
    console.error(`[SUPERVISOR] ${service.name} exited unexpectedly (code=${code}, signal=${signal || 'none'}).`);
    stop(code || 1);
  });
}

process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));
process.on('uncaughtException', error => {
  console.error('[SUPERVISOR] Uncaught exception:', error);
  stop(1);
});

console.log(`[SUPERVISOR] Started ${services.map(service => service.name).join(', ')}; gateway port=${gatewayPort}.`);
