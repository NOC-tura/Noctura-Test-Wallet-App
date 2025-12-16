import { create, type StateCreator } from 'zustand';
import { Keypair } from '@solana/web3.js';
import { StoredWallet, WalletMode } from '../types/wallet';
import { generateNewMnemonic, keypairToSecret, mnemonicToKeypair, secretKeyToKeypair } from '../lib/solana';

const STORAGE_KEY = 'noctura.wallet';

type WalletState = {
  keypair?: Keypair;
  mode: WalletMode;
  stored?: StoredWallet;
  hasWallet: boolean;
  initialize: () => void;
  setMode: (mode: WalletMode) => void;
  createWallet: () => string;
  importMnemonic: (mnemonic: string) => void;
  importSecret: (secret: string) => void;
  markAirdrop: () => void;
  reset: () => void;
};

function persist(stored: StoredWallet | undefined) {
  if (stored) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

const creator: StateCreator<WalletState> = (set, get) => ({
  mode: 'transparent',
  hasWallet: false,
  initialize: () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const stored = JSON.parse(raw) as StoredWallet;
      const secret = stored.secretKey;
      if (!secret) return;
      const keypair = secretKeyToKeypair(secret);
      set({ stored, keypair, hasWallet: true });
    } catch (err) {
      console.warn('Failed to restore persisted wallet', err);
      persist(undefined);
    }
  },
  setMode: (mode: WalletMode) => set({ mode }),
  createWallet: () => {
    const mnemonic = generateNewMnemonic();
    const keypair = mnemonicToKeypair(mnemonic);
    const stored: StoredWallet = { mnemonic, secretKey: keypairToSecret(keypair) };
    persist(stored);
    set({ keypair, stored, hasWallet: true });
    return mnemonic;
  },
  importMnemonic: (mnemonic: string) => {
    const keypair = mnemonicToKeypair(mnemonic);
    const stored: StoredWallet = { mnemonic, secretKey: keypairToSecret(keypair) };
    persist(stored);
    set({ keypair, stored, hasWallet: true });
  },
  importSecret: (secret: string) => {
    const keypair = secretKeyToKeypair(secret);
    const stored: StoredWallet = { secretKey: secret };
    persist(stored);
    set({ keypair, stored, hasWallet: true });
  },
  markAirdrop: () => {
    const stored = get().stored;
    if (stored) {
      stored.faucetGranted = true;
      persist(stored);
      set({ stored: { ...stored } });
    }
  },
  reset: () => {
    persist(undefined);
    set({ keypair: undefined, stored: undefined, hasWallet: false });
  },
});

export const useWallet = create<WalletState>()(creator);
