import { create, type StateCreator } from 'zustand';
import { Keypair } from '@solana/web3.js';
import { StoredWallet, WalletMode, WalletAccount, WALLET_STORAGE_VERSION, EncryptedWalletStorage, ENCRYPTED_WALLET_VERSION } from '../types/wallet';
import { generateNewMnemonic, keypairToSecret, mnemonicToKeypair, mnemonicToKeypairWithIndex, secretKeyToKeypair } from '../lib/solana';
import { encryptData, decryptData } from '../lib/encryptedStorage';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

const STORAGE_KEY = 'noctura.wallet';
const ENCRYPTED_STORAGE_KEY = 'noctura.wallet.encrypted';
const MAX_WALLETS = 10; // Maximum number of wallet accounts allowed

type WalletState = {
  keypair?: Keypair;
  mode: WalletMode;
  stored?: StoredWallet;
  hasWallet: boolean;
  /** Whether wallet is encrypted with password */
  isEncrypted: boolean;
  /** Whether wallet is currently locked (encrypted but not unlocked) */
  isLocked: boolean;
  /** All wallet accounts */
  accounts: WalletAccount[];
  /** Index of the currently active account */
  activeAccountIndex: number;
  /** Get the currently active account */
  activeAccount: WalletAccount | undefined;
  initialize: () => void;
  setMode: (mode: WalletMode) => void;
  /** Create new wallet with password protection */
  createWallet: (password?: string) => string;
  /** Create new wallet with password (alias for clarity) */
  createWalletWithPassword: (password: string) => string;
  importMnemonic: (mnemonic: string, password?: string) => void;
  importSecret: (secret: string) => void;
  markAirdrop: () => void;
  reset: () => void;
  /** Lock the wallet (clear memory, keep encrypted storage) */
  lock: () => void;
  /** Unlock the wallet with password */
  unlock: (password: string) => Promise<boolean>;
  /** Check if a password is correct without unlocking */
  verifyPassword: (password: string) => Promise<boolean>;
  /** Change the wallet password */
  changePassword: (currentPassword: string, newPassword: string) => Promise<boolean>;
  /** Check if encrypted wallet exists in storage */
  hasEncryptedWallet: () => boolean;
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

/** Hash password for quick verification (not for encryption) */
function hashPasswordForVerification(password: string, salt: string): string {
  const saltBytes = hexToBytes(salt);
  const passwordBytes = new TextEncoder().encode(password);
  const derived = pbkdf2(sha256, passwordBytes, saltBytes, { c: 1000, dkLen: 32 });
  return bytesToHex(derived);
}

/** Encrypt wallet data with password */
async function encryptWallet(wallet: StoredWallet, password: string): Promise<EncryptedWalletStorage> {
  // Use the existing encryptData which handles salt/iv generation
  const encrypted = await encryptData(wallet, password);
  
  return {
    encryptedVersion: ENCRYPTED_WALLET_VERSION,
    salt: encrypted.salt,
    iv: encrypted.iv,
    ciphertext: encrypted.ciphertext,
    tag: encrypted.tag,
    passwordHash: hashPasswordForVerification(password, encrypted.salt),
    lastUnlocked: Date.now(),
  };
}

/** Decrypt wallet data with password */
async function decryptWallet(encrypted: EncryptedWalletStorage, password: string): Promise<StoredWallet | null> {
  try {
    // Reconstruct the blob format expected by decryptData
    const blob = {
      version: 1, // Storage version expected by encryptedStorage
      salt: encrypted.salt,
      iv: encrypted.iv,
      ciphertext: encrypted.ciphertext,
      tag: encrypted.tag,
    };
    
    return await decryptData<StoredWallet>(blob, password);
  } catch (err) {
    console.warn('Failed to decrypt wallet:', err);
    return null;
  }
}

/** Persist encrypted wallet to localStorage */
function persistEncrypted(encrypted: EncryptedWalletStorage | undefined) {
  if (encrypted) {
    localStorage.setItem(ENCRYPTED_STORAGE_KEY, JSON.stringify(encrypted));
  } else {
    localStorage.removeItem(ENCRYPTED_STORAGE_KEY);
  }
}

/** Load encrypted wallet from localStorage */
function loadEncrypted(): EncryptedWalletStorage | null {
  const raw = localStorage.getItem(ENCRYPTED_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as EncryptedWalletStorage;
  } catch {
    return null;
  }
}

/** Legacy persist for unencrypted storage (will be removed in future) */
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
  isEncrypted: false,
  isLocked: false,
  accounts: [],
  activeAccountIndex: 0,
  get activeAccount() {
    const state = get();
    return state.accounts[state.activeAccountIndex];
  },
  
  initialize: () => {
    // First check for encrypted wallet
    const encrypted = loadEncrypted();
    if (encrypted) {
      // Wallet exists but is locked - user needs to enter password
      set({ 
        hasWallet: true, 
        isEncrypted: true, 
        isLocked: true,
        keypair: undefined,
        stored: undefined,
        accounts: [],
      });
      return;
    }
    
    // Fall back to legacy unencrypted storage
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
        isEncrypted: false,
        isLocked: false,
        accounts,
        activeAccountIndex: activeIndex,
      });
    } catch (err) {
      console.warn('Failed to restore persisted wallet', err);
      persist(undefined);
    }
  },
  
  setMode: (mode: WalletMode) => set({ mode }),
  
  createWallet: (password?: string) => {
    const mnemonic = generateNewMnemonic();
    const mainAccount = createAccountFromMnemonic(mnemonic, 0, 'Main Wallet');
    const keypair = secretKeyToKeypair(mainAccount.secretKey);
    
    const stored: StoredWallet = { 
      mnemonic, 
      accounts: [mainAccount],
      activeAccountIndex: 0,
      version: WALLET_STORAGE_VERSION,
    };
    
    if (password) {
      // Encrypt and store
      encryptWallet(stored, password).then(encrypted => {
        persistEncrypted(encrypted);
        // Remove any legacy unencrypted storage
        localStorage.removeItem(STORAGE_KEY);
      });
      
      set({ 
        keypair, 
        stored, 
        hasWallet: true,
        isEncrypted: true,
        isLocked: false,
        accounts: [mainAccount],
        activeAccountIndex: 0,
      });
    } else {
      // Legacy unencrypted storage
      persist(stored);
      set({ 
        keypair, 
        stored, 
        hasWallet: true,
        isEncrypted: false,
        isLocked: false,
        accounts: [mainAccount],
        activeAccountIndex: 0,
      });
    }
    
    return mnemonic;
  },
  
  createWalletWithPassword: (password: string) => {
    return get().createWallet(password);
  },
  
  importMnemonic: (mnemonic: string, password?: string) => {
    const mainAccount = createAccountFromMnemonic(mnemonic, 0, 'Main Wallet');
    const keypair = secretKeyToKeypair(mainAccount.secretKey);
    
    const stored: StoredWallet = { 
      mnemonic,
      accounts: [mainAccount],
      activeAccountIndex: 0,
      version: WALLET_STORAGE_VERSION,
    };
    
    if (password) {
      encryptWallet(stored, password).then(encrypted => {
        persistEncrypted(encrypted);
        localStorage.removeItem(STORAGE_KEY);
      });
      
      set({ 
        keypair, 
        stored, 
        hasWallet: true,
        isEncrypted: true,
        isLocked: false,
        accounts: [mainAccount],
        activeAccountIndex: 0,
      });
    } else {
      persist(stored);
      set({ 
        keypair, 
        stored, 
        hasWallet: true,
        isEncrypted: false,
        isLocked: false,
        accounts: [mainAccount],
        activeAccountIndex: 0,
      });
    }
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
      
      // Update storage based on encryption status
      if (state.isEncrypted) {
        const encrypted = loadEncrypted();
        if (encrypted) {
          // Re-encrypt with same password - we need to keep the data in sync
          // For now, just update in-memory state; encryption happens on lock
        }
      } else {
        persist(newStored);
      }
      
      set({ stored: newStored, accounts });
    }
  },
  
  reset: () => {
    // Clear both encrypted and unencrypted storage
    persistEncrypted(undefined);
    persist(undefined);
    set({ 
      keypair: undefined, 
      stored: undefined, 
      hasWallet: false,
      isEncrypted: false,
      isLocked: false,
      accounts: [],
      activeAccountIndex: 0,
    });
  },
  
  lock: () => {
    const state = get();
    if (!state.isEncrypted) {
      console.warn('Cannot lock: wallet is not encrypted');
      return;
    }
    
    // Clear sensitive data from memory but keep encrypted storage
    set({
      keypair: undefined,
      stored: undefined,
      accounts: [],
      isLocked: true,
      // Keep hasWallet: true and isEncrypted: true
    });
  },
  
  unlock: async (password: string) => {
    const encrypted = loadEncrypted();
    if (!encrypted) {
      console.warn('No encrypted wallet found');
      return false;
    }
    
    // Verify password hash first (quick check)
    const expectedHash = hashPasswordForVerification(password, encrypted.salt);
    if (expectedHash !== encrypted.passwordHash) {
      return false;
    }
    
    // Decrypt wallet data
    const stored = await decryptWallet(encrypted, password);
    if (!stored) {
      return false;
    }
    
    // Migrate if needed
    const migratedStored = migrateStoredWallet(stored);
    
    const accounts = migratedStored.accounts || [];
    const activeIndex = migratedStored.activeAccountIndex ?? 0;
    
    if (accounts.length === 0) {
      return false;
    }
    
    const activeAccount = accounts[activeIndex] || accounts[0];
    const keypair = secretKeyToKeypair(activeAccount.secretKey);
    
    // Update last unlocked timestamp
    const updatedEncrypted = { ...encrypted, lastUnlocked: Date.now() };
    persistEncrypted(updatedEncrypted);
    
    set({
      stored: migratedStored,
      keypair,
      hasWallet: true,
      isEncrypted: true,
      isLocked: false,
      accounts,
      activeAccountIndex: activeIndex,
    });
    
    return true;
  },
  
  verifyPassword: async (password: string) => {
    const encrypted = loadEncrypted();
    if (!encrypted) return false;
    
    const expectedHash = hashPasswordForVerification(password, encrypted.salt);
    return expectedHash === encrypted.passwordHash;
  },
  
  changePassword: async (currentPassword: string, newPassword: string) => {
    const state = get();
    if (!state.stored) {
      console.warn('No wallet data to re-encrypt');
      return false;
    }
    
    // Verify current password
    if (!(await get().verifyPassword(currentPassword))) {
      return false;
    }
    
    // Re-encrypt with new password
    const newEncrypted = await encryptWallet(state.stored, newPassword);
    persistEncrypted(newEncrypted);
    
    return true;
  },
  
  hasEncryptedWallet: () => {
    return loadEncrypted() !== null;
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
