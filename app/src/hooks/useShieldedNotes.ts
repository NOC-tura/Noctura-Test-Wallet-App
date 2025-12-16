import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ShieldedNoteRecord } from '../types/shield';

// Storage keys for fallback/verification
const STORAGE_KEY = 'noctura.shieldedNotes';
const STORAGE_STATE_KEY = '__noctura_shielded_state';

type ShieldedState = {
  notes: ShieldedNoteRecord[];
  nextLeafIndex: number;
  currentWallet: string | null;
  addNote: (note: ShieldedNoteRecord) => void;
  markNoteSpent: (nullifier: string) => void;
  markMultipleSpent: (nullifiers: string[]) => void;
  setWallet: (walletAddress: string) => void;
  getNotesForWallet: (walletAddress: string) => ShieldedNoteRecord[];
  removeNotesNotOwnedBy: (walletAddress: string) => void;
  reset: () => void;
  verifyPersistence: () => boolean;
  manualSave: () => void;
  manualLoad: () => boolean;
};

export const useShieldedNotes = create<ShieldedState>()(
  persist(
    (set, get) => ({
      notes: [],
      nextLeafIndex: 0,
      currentWallet: null,
      addNote: (note) =>
        set((state) => {
          const leafIndex = note.leafIndex ?? state.nextLeafIndex;
          
          // Prevent duplicate notes (check by nullifier)
          const isDuplicate = state.notes.some(n => n.nullifier === note.nullifier);
          if (isDuplicate) {
            console.warn('[useShieldedNotes] DUPLICATE NOTE DETECTED, skipping:', {
              nullifier: note.nullifier.slice(0, 16),
              amount: note.amount,
              tokenType: note.tokenType,
              existingCount: state.notes.filter(n => n.nullifier === note.nullifier).length,
            });
            return state; // Don't add duplicate
          }
          
          const enriched: ShieldedNoteRecord = {
            ...note,
            leafIndex,
            createdAt: note.createdAt ?? Date.now(),
          };
          console.log('[useShieldedNotes] Adding note to store:', {
            nullifier: enriched.nullifier.slice(0, 16),
            amount: enriched.amount,
            tokenType: enriched.tokenType,
            leafIndex: enriched.leafIndex,
            totalNotesAfter: state.notes.length + 1,
          });
          
          const newState = {
            notes: [...state.notes, enriched].sort((a, b) => a.leafIndex - b.leafIndex),
            nextLeafIndex: Math.max(state.nextLeafIndex, leafIndex + 1),
          };
          
          // Immediately verify persistence after adding
          setTimeout(() => {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
              try {
                const parsed = JSON.parse(stored);
                const storedNotes = parsed.state?.notes || [];
                const found = storedNotes.some((n: ShieldedNoteRecord) => n.nullifier === enriched.nullifier);
                if (found) {
                  console.log('[useShieldedNotes] ✅ Note verified in localStorage after add');
                } else {
                  console.error('[useShieldedNotes] ⚠️  WARNING: Note NOT found in localStorage after add!', {
                    nullifier: enriched.nullifier.slice(0, 16),
                    storedCount: storedNotes.length,
                  });
                }
              } catch (err) {
                console.error('[useShieldedNotes] Failed to verify persistence:', err);
              }
            } else {
              console.error('[useShieldedNotes] ⚠️  CRITICAL: No localStorage data found for', STORAGE_KEY);
            }
          }, 100);
          
          return newState;
        }),
      markNoteSpent: (nullifier) =>
        set((state) => ({
          notes: state.notes.map((note) =>
            note.nullifier === nullifier ? { ...note, spent: true } : note
          ),
        })),
      markMultipleSpent: (nullifiers) =>
        set((state) => ({
          notes: state.notes.map((note) =>
            nullifiers.includes(note.nullifier) ? { ...note, spent: true } : note
          ),
        })),
      setWallet: (walletAddress) => set({ currentWallet: walletAddress }),
      getNotesForWallet: (walletAddress) => {
        return get().notes.filter((note) => note.owner === walletAddress);
      },
      removeNotesNotOwnedBy: (walletAddress) =>
        set((state) => ({
          notes: state.notes.filter((note) => note.owner === walletAddress),
        })),
      reset: () => set({ notes: [], nextLeafIndex: 0, currentWallet: null }),
      verifyPersistence: () => {
        const inMemory = get().notes.length;
        const stored = localStorage.getItem(STORAGE_KEY);
        let inStorage = 0;
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            inStorage = parsed.state?.notes?.length || 0;
          } catch {
            // ignore
          }
        }
        const match = inMemory === inStorage;
        console.log('[useShieldedNotes.verify]', {
          inMemory,
          inStorage,
          match: match ? '✅ MATCH' : '❌ MISMATCH',
        });
        return match;
      },
      manualSave: () => {
        const state = get();
        try {
          const data = {
            state: {
              notes: state.notes,
              nextLeafIndex: state.nextLeafIndex,
              currentWallet: state.currentWallet,
            },
            version: 0,
          };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
          console.log('[useShieldedNotes.manualSave] ✅ Saved', state.notes.length, 'notes to localStorage');
        } catch (err) {
          console.error('[useShieldedNotes.manualSave] Failed to save:', err);
        }
      },
      manualLoad: () => {
        try {
          const stored = localStorage.getItem(STORAGE_KEY);
          if (!stored) {
            console.log('[useShieldedNotes.manualLoad] No data in localStorage');
            return false;
          }
          const parsed = JSON.parse(stored);
          const { notes, nextLeafIndex, currentWallet } = parsed.state || {};
          if (notes && Array.isArray(notes)) {
            set({ notes, nextLeafIndex: nextLeafIndex || 0, currentWallet: currentWallet || null });
            console.log('[useShieldedNotes.manualLoad] ✅ Loaded', notes.length, 'notes from localStorage');
            return true;
          }
          return false;
        } catch (err) {
          console.error('[useShieldedNotes.manualLoad] Failed to load:', err);
          return false;
        }
      },
    }),
    {
      name: STORAGE_KEY,
      version: 0,
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.error('[useShieldedNotes] Rehydration error:', error);
        } else if (state) {
          console.log('[useShieldedNotes] Rehydrated with', state.notes.length, 'notes');
        }
      },
    }
  )
);
