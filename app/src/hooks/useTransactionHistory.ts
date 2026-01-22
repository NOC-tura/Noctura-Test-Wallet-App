import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Storage key for persistence
const STORAGE_KEY = 'noctura.transactionHistory';

export type TransactionType = 
  | 'public_send'       // Transparent send
  | 'public_receive'    // Transparent receive
  | 'shield_deposit'    // Deposit into shielded vault
  | 'shield_withdraw'   // Withdraw from shielded to transparent (partial privacy - outgoing)
  | 'partial_receive'   // Receive from partial privacy transfer (transparent receive from shielded sender)
  | 'shielded_send'     // Shielded-to-shielded transfer (outgoing)
  | 'shielded_receive'  // Shielded-to-shielded transfer (incoming)
  | 'consolidate';      // Note consolidation

export type TransactionStatus = 'success' | 'failed' | 'pending';

export interface TransactionRecord {
  id: string;                    // Unique ID (signature or generated)
  type: TransactionType;
  status: TransactionStatus;
  timestamp: number;             // Unix timestamp in ms
  signature?: string;            // On-chain signature (if available)
  amount: string;                // Amount as string
  token: 'SOL' | 'NOC';
  from?: string;                 // Sender address/label
  to?: string;                   // Recipient address/label
  fee?: string;                  // Fee paid
  memo?: string;                 // Any memo/note
  isShielded: boolean;           // Whether this involved shielded pool
  walletAddress: string;         // Which wallet this belongs to
}

type TransactionHistoryState = {
  transactions: TransactionRecord[];
  addTransaction: (tx: Omit<TransactionRecord, 'id' | 'timestamp'> & { id?: string; timestamp?: number }) => void;
  getTransactionsForWallet: (walletAddress: string) => TransactionRecord[];
  updateTransactionStatus: (id: string, status: TransactionStatus, signature?: string) => void;
  clearHistory: () => void;
};

export const useTransactionHistory = create<TransactionHistoryState>()(
  persist(
    (set, get) => ({
      transactions: [],

      addTransaction: (tx) => {
        const newTx: TransactionRecord = {
          ...tx,
          id: tx.id || tx.signature || `tx_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          timestamp: tx.timestamp || Date.now(),
        };

        // Prevent duplicate transactions (by signature or id)
        const isDuplicate = get().transactions.some(
          t => t.id === newTx.id || (newTx.signature && t.signature === newTx.signature)
        );

        if (isDuplicate) {
          console.log('[TransactionHistory] Skipping duplicate transaction:', newTx.id.slice(0, 16));
          return;
        }

        console.log('[TransactionHistory] Adding transaction:', {
          id: newTx.id.slice(0, 16),
          type: newTx.type,
          amount: newTx.amount,
          token: newTx.token,
          isShielded: newTx.isShielded,
        });

        set((state) => ({
          transactions: [newTx, ...state.transactions].slice(0, 100), // Keep last 100 transactions
        }));
      },

      getTransactionsForWallet: (walletAddress) => {
        return get().transactions.filter(tx => tx.walletAddress === walletAddress);
      },

      updateTransactionStatus: (id, status, signature) => {
        set((state) => ({
          transactions: state.transactions.map((tx) =>
            tx.id === id ? { ...tx, status, signature: signature || tx.signature } : tx
          ),
        }));
      },

      clearHistory: () => set({ transactions: [] }),
    }),
    {
      name: STORAGE_KEY,
      version: 1, // Incremented to clear old transactions with incorrect amounts
    }
  )
);

// Helper function to get display info for transaction types
export function getTransactionDisplayInfo(type: TransactionType): { icon: string; label: string } {
  switch (type) {
    case 'public_send':
      return { icon: '📤', label: 'Public Send' };
    case 'public_receive':
      return { icon: '📥', label: 'Public Receive' };
    case 'shield_deposit':
      return { icon: '🛡️', label: 'Shield Deposit' };
    case 'shield_withdraw':
      return { icon: '🔓', label: 'Unshield' };
    case 'partial_receive':
      return { icon: '📥', label: 'Partial Privacy Receive' };
    case 'shielded_send':
      return { icon: '🔒', label: 'Private Send' };
    case 'shielded_receive':
      return { icon: '🔐', label: 'Private Receive' };
    case 'consolidate':
      return { icon: '🔄', label: 'Consolidate' };
    default:
      return { icon: '📋', label: 'Transaction' };
  }
}
