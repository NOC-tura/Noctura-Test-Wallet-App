import { create, type StateCreator } from 'zustand';
import { Keypair } from '@solana/web3.js';
import { StoredWallet, WalletMode, WalletAccount, WALLET_STORAGE_VERSION } from '../types/wallet';
import { generateNewMnemonic, keypairToSecret, mnemonicToKeypair, mnemonicToKeypairWithIndex, secretKeyToKeypair } from '../lib/solana';

const STORAGE_KEY = 'noctura.wallet';
const MAX_WALLETS = 10; // Maximum number of wallet accounts allowed

type WalletState = {
  keypair?: Keypair;
  mode: WalletMode;
  stored?: StoredWallet;
  hasWallet: boolean;
  /** All wallet accounts */
  accounts: WalletAccount[];
  /** Index of the currently active account */
  activeAccountIndex: number;
  /** Get the currently active account */
  activeAccount: WalletAccount | undefined;
  initialize: () => void;
  setMode: (mode: WalletMode) => void;
  createWallet: () => string;
  importMnemonic: (mnemonic: string) => void;
  importSecret: (secret: string) => void;
  markAirdrop: () => void;
  reset: () => void;
  /** Add a new wallet account (derived from same mnemonic) */
  addWallet: (name?: string) => WalletAccount | null;
  /** Switch to a different wallet account */
  switchWallet: (index: number) => void;
  /** Rename a wallet account */
  renameWallet: (index: number, newName: string) => void;
  /** Remove a wallet account (cannot remove the main wallet at index 0) */
  removeWallet: (index: number) => boolean;
  /** Get the total number of wallet accounts */
  getWalletCount: () => number;
};

function persist(stored: StoredWallet | undefined) {
  if (stored) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

/**
 * Migrate old single-wallet storage format to new multi-wallet format
 */
function migrateStoredWallet(stored: StoredWallet): StoredWallet {
  // Already migrated
  if (stored.version === WALLET_STORAGE_VERSION && stored.accounts && stored.accounts.length > 0) {
    return stored;
  }
  
  // Old format: has secretKey but no accounts array
  if (stored.secretKey && (!stored.accounts || stored.accounts.length === 0)) {
    const keypair = secretKeyToKeypair(stored.secretKey);
    const mainAccount: WalletAccount = {
      name: 'Main Wallet',
      derivationIndex: 0,
      secretKey: stored.secretKey,
      publicAddress: keypair.publicKey.toBase58(),
      faucetGranted: stored.faucetGranted,
    };
    
    return {
      ...stored,
      accounts: [mainAccount],
      activeAccountIndex: 0,
      version: WALLET_STORAGE_VERSION,
    };
  }
  
  return stored;
}

/**
 * Create a new wallet account from mnemonic at the specified derivation index
 */
function createAccountFromMnemonic(mnemonic: string, derivationIndex: number, name: string): WalletAccount {
  const keypair = mnemonicToKeypairWithIndex(mnemonic, derivationIndex);
  return {
    name,
    derivationIndex,
    secretKey: keypairToSecret(keypair),
    publicAddress: keypair.publicKey.toBase58(),
    faucetGranted: false,
  };
}

const creator: StateCreator<WalletState> = (set, get) => ({
  mode: 'transparent',
  hasWallet: false,
  accounts: [],
  activeAccountIndex: 0,
  get activeAccount() {
    const state = get();
    return state.accounts[state.activeAccountIndex];
  },
  
  initialize: () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      let stored = JSON.parse(raw) as StoredWallet;
      
      // Migrate old format to new format
      stored = migrateStoredWallet(stored);
      persist(stored); // Save migrated format
      
      const accounts = stored.accounts || [];
      const activeIndex = stored.activeAccountIndex ?? 0;
      
      if (accounts.length === 0) return;
      
      const activeAccount = accounts[activeIndex] || accounts[0];
      const keypair = secretKeyToKeypair(activeAccount.secretKey);
      
      set({ 
        stored, 
        keypair, 
        hasWallet: true,
        accounts,
        activeAccountIndex: activeIndex,
      });
    } catch (err) {
      console.warn('Failed to restore persisted wallet', err);
      persist(undefined);
    }
  },
  
  setMode: (mode: WalletMode) => set({ mode }),
  
  createWallet: () => {
    const mnemonic = generateNewMnemonic();
    const mainAccount = createAccountFromMnemonic(mnemonic, 0, 'Main Wallet');
    const keypair = secretKeyToKeypair(mainAccount.secretKey);
    
    const stored: StoredWallet = { 
      mnemonic, 
      accounts: [mainAccount],
      activeAccountIndex: 0,
      version: WALLET_STORAGE_VERSION,
    };
    
    persist(stored);
    set({ 
      keypair, 
      stored, 
      hasWallet: true,
      accounts: [mainAccount],
      activeAccountIndex: 0,
    });
    return mnemonic;
  },
  
  importMnemonic: (mnemonic: string) => {
    const mainAccount = createAccountFromMnemonic(mnemonic, 0, 'Main Wallet');
    const keypair = secretKeyToKeypair(mainAccount.secretKey);
    
    const stored: StoredWallet = { 
      mnemonic,
      accounts: [mainAccount],
      activeAccountIndex: 0,
      version: WALLET_STORAGE_VERSION,
    };
    
    persist(stored);
    set({ 
      keypair, 
      stored, 
      hasWallet: true,
      accounts: [mainAccount],
      activeAccountIndex: 0,
    });
  },
  
  importSecret: (secret: string) => {
    const keypair = secretKeyToKeypair(secret);
    const mainAccount: WalletAccount = {
      name: 'Main Wallet',
      derivationIndex: 0,
      secretKey: secret,
      publicAddress: keypair.publicKey.toBase58(),
      faucetGranted: false,
    };
    
    const stored: StoredWallet = { 
      secretKey: secret, // Keep for backwards compat
      accounts: [mainAccount],
      activeAccountIndex: 0,
      version: WALLET_STORAGE_VERSION,
    };
    
    persist(stored);
    set({ 
      keypair, 
      stored, 
      hasWallet: true,
      accounts: [mainAccount],
      activeAccountIndex: 0,
    });
  },
  
  markAirdrop: () => {
    const state = get();
    const stored = state.stored;
    const accounts = [...state.accounts];
    
    if (stored && accounts[state.activeAccountIndex]) {
      accounts[state.activeAccountIndex] = {
        ...accounts[state.activeAccountIndex],
        faucetGranted: true,
      };
      
      const newStored = { 
        ...stored, 
        accounts,
        faucetGranted: true, // Keep for backwards compat
      };
      persist(newStored);
      set({ stored: newStored, accounts });
    }
  },
  
  reset: () => {
    persist(undefined);
    set({ 
      keypair: undefined, 
      stored: undefined, 
      hasWallet: false,
      accounts: [],
      activeAccountIndex: 0,
    });
  },
  
  addWallet: (name?: string) => {
    const state = get();
    const stored = state.stored;
    
    if (!stored?.mnemonic) {
      console.warn('Cannot add wallet: no mnemonic available (imported via secret key)');
      return null;
    }
    
    if (state.accounts.length >= MAX_WALLETS) {
      console.warn(`Cannot add wallet: maximum of ${MAX_WALLETS} wallets reached`);
      return null;
    }
    
    // Find the next available derivation index
    const usedIndices = state.accounts.map(a => a.derivationIndex);
    let nextIndex = 0;
    while (usedIndices.includes(nextIndex)) {
      nextIndex++;
    }
    
    // Generate default name if not provided
    const walletName = name || `Wallet ${state.accounts.length}`;
    
    // Create new account
    const newAccount = createAccountFromMnemonic(stored.mnemonic, nextIndex, walletName);
    const newAccounts = [...state.accounts, newAccount];
    
    const newStored: StoredWallet = {
      ...stored,
      accounts: newAccounts,
    };
    
    persist(newStored);
    set({ stored: newStored, accounts: newAccounts });
    
    return newAccount;
  },
  
  switchWallet: (index: number) => {
    const state = get();
    
    if (index < 0 || index >= state.accounts.length) {
      console.warn(`Cannot switch to wallet index ${index}: out of range`);
      return;
    }
    
    const account = state.accounts[index];
    const keypair = secretKeyToKeypair(account.secretKey);
    
    const newStored: StoredWallet = {
      ...state.stored!,
      activeAccountIndex: index,
    };
    
    persist(newStored);
    set({ 
      keypair, 
      stored: newStored, 
      activeAccountIndex: index,
    });
  },
  
  renameWallet: (index: number, newName: string) => {
    const state = get();
    
    if (index < 0 || index >= state.accounts.length) {
      console.warn(`Cannot rename wallet index ${index}: out of range`);
      return;
    }
    
    const accounts = [...state.accounts];
    accounts[index] = { ...accounts[index], name: newName.trim() || accounts[index].name };
    
    const newStored: StoredWallet = {
      ...state.stored!,
      accounts,
    };
    
    persist(newStored);
    set({ stored: newStored, accounts });
  },
  
  removeWallet: (index: number) => {
    const state = get();
    
    // Cannot remove main wallet
    if (index === 0) {
      console.warn('Cannot remove main wallet (index 0)');
      return false;
    }
    
    if (index < 0 || index >= state.accounts.length) {
      console.warn(`Cannot remove wallet index ${index}: out of range`);
      return false;
    }
    
    const accounts = state.accounts.filter((_, i) => i !== index);
    
    // If we removed the active wallet, switch to main wallet
    let newActiveIndex = state.activeAccountIndex;
    if (state.activeAccountIndex === index) {
      newActiveIndex = 0;
    } else if (state.activeAccountIndex > index) {
      // Adjust active index if it was after the removed one
      newActiveIndex = state.activeAccountIndex - 1;
    }
    
    const keypair = secretKeyToKeypair(accounts[newActiveIndex].secretKey);
    
    const newStored: StoredWallet = {
      ...state.stored!,
      accounts,
      activeAccountIndex: newActiveIndex,
    };
    
    persist(newStored);
    set({ 
      stored: newStored, 
      accounts, 
      activeAccountIndex: newActiveIndex,
      keypair,
    });
    
    return true;
  },
  
  getWalletCount: () => {
    return get().accounts.length;
  },
});

export const useWallet = create<WalletState>()(creator);
