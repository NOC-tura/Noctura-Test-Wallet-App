import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { config } from './config.js';

export class HeliusClient {
  private connection: Connection;
  private feePayer: Keypair;

  constructor() {
    this.connection = new Connection(config.heliusRpcUrl, 'confirmed');
    this.feePayer = Keypair.fromSecretKey(bs58.decode(config.feePayerSecretKey));
    console.log(`Relayer fee payer: ${this.feePayer.publicKey.toBase58()}`);
  }

  /**
   * Call Helius getValidityProof for ZK Compression
   */
  async getValidityProof(params: {
    hashes: string[];
    newAddresses?: string[];
  }): Promise<any> {
    const response = await fetch(config.heliusRpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'getValidityProof',
        params: [params.hashes, params.newAddresses || []],
      }),
    });

    const data = await response.json();
    if (data.error) {
      throw new Error(`getValidityProof error: ${data.error.message}`);
    }
    return data.result;
  }

  /**
   * Submit a transaction to Solana via Helius
   */
  async submitTransaction(transaction: Transaction): Promise<string> {
    transaction.feePayer = this.feePayer.publicKey;
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;

    // Sign with fee payer
    transaction.partialSign(this.feePayer);

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [this.feePayer],
      { commitment: 'confirmed' }
    );

    console.log(`Transaction submitted: ${signature}`);
    return signature;
  }

  /**
   * Get account info (for balance checks, etc.)
   */
  async getAccountInfo(pubkey: PublicKey) {
    return this.connection.getAccountInfo(pubkey);
  }

  /**
   * Get balance
   */
  async getBalance(pubkey: PublicKey): Promise<number> {
    return this.connection.getBalance(pubkey);
  }

  getConnection(): Connection {
    return this.connection;
  }

  getFeePayer(): Keypair {
    return this.feePayer;
  }
}
