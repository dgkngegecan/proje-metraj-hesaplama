import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { E2E_PORT } from '../playwright.config.ts';
import { repoRoot, runDirectory, webRoot, writeState } from './support/runtime.ts';

/** Bir koşulun doğru olmasını bekler (süreç başlangıcı için; testlerde kullanılmaz). */
async function waitFor<T>(
  what: string,
  probe: () => Promise<T | null | undefined | false>,
  timeoutMs: number,
  onTick?: () => void,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    onTick?.();
    const value = await probe().catch(() => null);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`${what} zamanında hazır olmadı (${timeoutMs / 1000} sn).`);
    await sleep(250);
  }
}

function tail(file: string, lines = 30) {
  try {
    return readFileSync(file, 'utf8').split(/\r?\n/).slice(-lines).join('\n');
  } catch {
    return '(günlük yok)';
  }
}

function start(command: string, args: string[], cwd: string, logFile: string, env: NodeJS.ProcessEnv): ChildProcess {
  const log = openSync(logFile, 'w');
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', log, log], windowsHide: true });
  closeSync(log);
  return child;
}

/**
 * DevServer'ı `--fresh` ile başlatır (göç + standart katalog tohumlaması dahil), adresini
 * url dosyasından okur, sonra o adrese `/api` vekili kuran `vite preview`'u (dist'i sunar)
 * başlatır. Çıktıdaki süreç kimlikleri globalTeardown'da kapatılır.
 */
export default async function globalSetup() {
  const runDir = runDirectory();
  const urlFile = path.join(runDir, 'url.txt');
  const dbFile = path.join(runDir, 'metraj.db');
  rmSync(urlFile, { force: true });

  if (!existsSync(path.join(webRoot, 'dist', 'mobile.html'))) {
    throw new Error('dist/mobile.html yok: önce `npm run build` çalıştırın (npm run test:e2e bunu kendisi yapar).');
  }

  const dotnet = process.env.METRAJ_DOTNET?.trim() || 'dotnet';
  const devLog = path.join(runDir, 'devserver.log');
  const dev = start(
    dotnet,
    [
      'run',
      '--project',
      'tools/Metraj.DevServer',
      '-c',
      'Release',
      '--',
      '--db',
      dbFile,
      '--url-file',
      urlFile,
      '--fresh',
    ],
    repoRoot,
    devLog,
    process.env,
  );
  const pids: number[] = [];
  if (dev.pid) pids.push(dev.pid);
  let devExited = false;
  dev.on('exit', () => (devExited = true));

  let apiUrl: string;
  try {
    apiUrl = await waitFor(
      'DevServer',
      async () => {
        if (!existsSync(urlFile)) return null;
        const url = readFileSync(urlFile, 'utf8').trim();
        if (!url) return null;
        const health = await fetch(`${url}/api/health`);
        return health.ok ? url : null;
      },
      180_000,
      () => {
        if (devExited) throw new Error(`DevServer erken kapandı:\n${tail(devLog)}`);
      },
    );
  } catch (error) {
    writeState({ apiUrl: '', previewUrl: '', pids, runDir });
    throw error;
  }

  const previewLog = path.join(runDir, 'preview.log');
  const preview = start(
    process.execPath,
    [
      path.join(webRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
      'preview',
      '--port',
      String(E2E_PORT),
      '--strictPort',
      '--host',
      '127.0.0.1',
    ],
    webRoot,
    previewLog,
    { ...process.env, METRAJ_API_URL: apiUrl },
  );
  if (preview.pid) pids.push(preview.pid);
  let previewExited = false;
  preview.on('exit', () => (previewExited = true));

  const previewUrl = `http://127.0.0.1:${E2E_PORT}`;
  writeState({ apiUrl, previewUrl, pids, runDir });
  await waitFor(
    'vite preview',
    async () => {
      const health = await fetch(`${previewUrl}/api/health`);
      return health.ok;
    },
    60_000,
    () => {
      if (previewExited) throw new Error(`vite preview kapandı (port ${E2E_PORT} dolu olabilir):\n${tail(previewLog)}`);
    },
  );
}
