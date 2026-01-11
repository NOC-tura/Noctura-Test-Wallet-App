import { ShieldedNoteRecord } from '../types/shield';
import { NOC_TOKEN_MINT, WSOL_MINT } from '../lib/constants';

type TokenKind = 'SOL' | 'NOC';

function resolveToken(note: ShieldedNoteRecord): TokenKind | undefined {
  if (note.tokenType) return note.tokenType;
  if (note.tokenMintAddress === NOC_TOKEN_MINT) return 'NOC';
  if (note.tokenMintAddress === WSOL_MINT) return 'SOL';
  return undefined;
}

export type NoteSelectionResult = {
  selectedNotes: ShieldedNoteRecord[];
  totalSelected: bigint;
  changeAmount: bigint;
};

/**
 * Greedy largest-first selector to cover requestedAmount with minimal notes.
 * Optional maxNotes caps how many notes can be returned (circuit input limit).
 */
export function selectNotesForAmount(
  requestedAmount: bigint,
  availableNotes: ShieldedNoteRecord[],
  token: TokenKind,
  maxNotes: number = Infinity,
): NoteSelectionResult {
  const validNotes = availableNotes
    .filter((note) => !note.spent && resolveToken(note) === token)
    .sort((a, b) => Number(BigInt(b.amount) - BigInt(a.amount)));

  const selectedNotes: ShieldedNoteRecord[] = [];
  let totalSelected = 0n;

  for (const note of validNotes) {
    if (selectedNotes.length >= maxNotes) break;
    if (totalSelected >= requestedAmount) break;
    selectedNotes.push(note);
    totalSelected += BigInt(note.amount);
  }

  if (totalSelected < requestedAmount) {
    throw new Error(`Insufficient ${token}. Requested ${requestedAmount}, available ${totalSelected}`);
  }

  if (selectedNotes.length > maxNotes) {
    throw new Error(`Selected notes exceed max ${maxNotes}`);
  }

  const changeAmount = totalSelected - requestedAmount;
  return { selectedNotes, totalSelected, changeAmount };
}
