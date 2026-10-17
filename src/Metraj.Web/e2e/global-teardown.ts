import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { readState, runDirectory } from './support/runtime.ts';

/** globalSetup'ın başlattığı süreçleri (alt süreçleriyle) kapatır. */
export default async function globalTeardown() {
  if (!existsSync(path.join(runDirectory(), 'state.json'))) return;
  const { pids } = readState();
  for (const pid of pids) {
    try {
      if (process.platform === 'win32') {
        // `dotnet run` asıl uygulamayı alt süreç olarak başlatır; /T hepsini kapatır.
        execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        process.kill(pid, 'SIGTERM');
      }
    } catch {
      // Süreç zaten kapanmış.
    }
  }
}
