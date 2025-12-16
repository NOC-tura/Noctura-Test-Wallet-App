import { mkdirSync } from 'fs';
import { join } from 'path';

export const ROOT = new URL('..', import.meta.url).pathname;
export const BUILD_DIR = join(ROOT, 'build');
export const KEYS_DIR = join(ROOT, 'keys');

export const CIRCUITS = ['deposit', 'transfer', 'withdraw', 'partial_withdraw', 'consolidate'];

export function ensureDirs() {
  mkdirSync(BUILD_DIR, { recursive: true });
  mkdirSync(KEYS_DIR, { recursive: true });
}
