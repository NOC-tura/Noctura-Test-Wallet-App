export type WalletMode = 'transparent' | 'shielded';

/**
 * Represents a single wallet account derived from the master seed.
 * Each account has its own derivation index, generating unique keypairs.
 */
export interface WalletAccount {
  /** Display name for the wallet (e.g., "Main Wallet", "Wallet 1") */
  name: string;
  /** Derivation index (0 = main wallet, 1+ = additional wallets) */
  derivationIndex: number;
  /** Base58 encoded secret key for this account */
  secretKey: string;
  /** Transparent public address (Solana format) */
  publicAddress: string;
  /** Whether this account has received faucet airdrop */
  faucetGranted?: boolean;
}

export interface StoredWallet {
  /** The master mnemonic (12 words) - shared across all accounts */
  mnemonic?: string;
  /** @deprecated Use accounts array instead. Kept for migration from old format. */
  secretKey?: string; // base58 encoded
  /** @deprecated Use accounts array instead */
  shieldedViewKey?: string;
  /** @deprecated Use accounts[].faucetGranted instead */
  faucetGranted?: boolean;
  /** Array of wallet accounts derived from the mnemonic */
  accounts?: WalletAccount[];
  /** Index of the currently active wallet account */
  activeAccountIndex?: number;
  /** Storage format version for future migrations */
  version?: number;
}

/** Current storage format version */
export const WALLET_STORAGE_VERSION = 2;
