import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const STORE_PATH = join(process.cwd(), 'data', 'airdrop-log.json');

type Store = {
  wallets: string[];
};

let cache: Store = { wallets: [] };

if (existsSync(STORE_PATH)) {
  cache = JSON.parse(readFileSync(STORE_PATH, 'utf-8')) as Store;
}

function persist() {
  writeFileSync(STORE_PATH, JSON.stringify(cache, null, 2));
}

export function hasWallet(address: string): boolean {
  return cache.wallets.includes(address);
}

export function registerWallet(address: string) {
  if (!cache.wallets.includes(address)) {
    cache.wallets.push(address);
    persist();
  }
}
