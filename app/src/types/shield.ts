export type ShieldedNoteRecord = {
  commitment: string;
  nullifier: string;
  amount: string;
  tokenMintField: string;
  tokenMintAddress: string;
  owner: string;
  secret: string;
  blinding: string;
  rho: string;
  leafIndex: number;
  spent?: boolean;
  createdAt?: number;
  signature?: string;
  tokenType?: 'NOC' | 'SOL';  // Track what token type this note represents
};
