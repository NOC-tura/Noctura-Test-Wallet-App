import { ShieldedNoteRecord } from './shield';

export interface NoteDatabase {
  notes: Map<string, ShieldedNoteRecord[]>;
  getAllNotes(owner: string, token: 'SOL' | 'NOC'): ShieldedNoteRecord[];
  getUnspentNotes(owner: string, token: 'SOL' | 'NOC'): ShieldedNoteRecord[];
  markNotesAsSpent(noteIds: string[]): void;
  addNote(note: ShieldedNoteRecord): void;
  getTotalBalance(owner: string, token: 'SOL' | 'NOC'): bigint;
}
