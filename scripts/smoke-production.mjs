import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

// Exercise the actual production entry point and built assets without making model calls.
const env = { ...process.env, HOST: '127.0.0.1', PORT: '3099', NODE_ENV: 'production' };
for (const key of Object.keys(env)) if (key.startsWith('BOLRELAY_')) delete env[key];
for (const key of [
  'BOLRELAY_MODEL_URL',
  'BOLRELAY_MODEL',
  'BOLRELAY_MODEL_API_KEY',
  'BOLRELAY_ACCESS_TOKEN',
]) env[key] = ''; // Keep a local .env file from enabling an external provider in this check.
const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], {
  cwd: process.cwd(),
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (chunk) => (output += chunk));
child.stderr.on('data', (chunk) => (output += chunk));
const request = (path = '', options = {}) =>
  fetch(`http://127.0.0.1:3099${path}`, {
    ...options,
    signal: AbortSignal.timeout(5_000),
  });

try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Server startup timed out: ${output}`)),
      10_000,
    );
    const ready = (chunk) => {
      if (chunk.toString().includes('BolRelay is listening')) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on('data', ready);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited with ${code}: ${output}`));
    });
  });

  const index = await request();
  assert.equal(index.status, 200);
  const html = await index.text();
  assert.match(html, /<title>BolRelay/);
  assert.equal(index.headers.get('x-frame-options'), 'DENY');
  assert.equal(index.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(index.headers.get('referrer-policy'), 'no-referrer');

  const asset = html.match(/src="([^"]+\.js)"/)?.[1];
  assert.ok(asset, 'The production page must load a JavaScript bundle.');
  const script = await request(asset);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type') ?? '', /javascript/);

  const status = await request('/api/status');
  assert.equal(status.status, 200);
  const data = await status.json();
  assert.equal(data.modelConfigured, false);
  assert.equal(data.localRulesAvailable, true);
  assert.equal(status.headers.get('cache-control'), 'no-store');
  assert.equal((await request('/api/health')).status, 200);

  const disabled = await request('/api/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(disabled.status, 503);
  const method = await request('/api/analyze');
  assert.equal(method.status, 405);
  assert.equal(method.headers.get('allow'), 'POST');
  assert.equal((await request('/api/unknown')).status, 404);
  assert.equal((await request('/not-an-api', { method: 'POST' })).status, 404);

  console.log(
    'Production smoke passed: HTML, assets, headers, status, health, disabled model, methods, and 404s.',
  );
  console.log('External model calls: 0.');
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 2_000);
    await exited;
    clearTimeout(timer);
  }
}
