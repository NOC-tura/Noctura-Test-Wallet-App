export type WalletMode = 'transparent' | 'shielded';

export interface StoredWallet {
  mnemonic?: string;
  secretKey?: string; // base58 encoded
  shieldedViewKey?: string;
  faucetGranted?: boolean;
}
