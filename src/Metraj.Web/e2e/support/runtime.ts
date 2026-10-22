import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Çalışma durumu: globalSetup yazar, testler ve globalTeardown okur. */
export interface RunState {
  /** DevServer'ın yerel API adresi (doğrudan; vekilsiz). */
  apiUrl: string;
  /** vite preview adresi (mobil arayüz + /api vekili). */
  previewUrl: string;
  pids: number[];
  runDir: string;
}

export const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const repoRoot = path.resolve(webRoot, '..', '..');

/** Veritabanı, url dosyası ve günlükler burada; TEMP D: üzerindeyse C:'ye yazılmaz. */
export function runDirectory(): string {
  const dir = process.env.METRAJ_E2E_DIR?.trim() || path.join(os.tmpdir(), 'metraj-e2e');
  mkdirSync(dir, { recursive: true });
  return dir;
}

const stateFile = () => path.join(runDirectory(), 'state.json');

export function writeState(state: RunState) {
  writeFileSync(stateFile(), JSON.stringify(state, null, 2));
}

export function readState(): RunState {
  if (!existsSync(stateFile())) throw new Error('E2E durum dosyası yok: globalSetup çalışmadı.');
  return JSON.parse(readFileSync(stateFile(), 'utf8')) as RunState;
}
