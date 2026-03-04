import React, { useState, useCallback } from 'react';
import { ShieldedNoteRecord } from '../types/shield';

export interface ConsolidateModalProps {
  isOpen: boolean;
  onClose: () => void;
  shieldedNotes: ShieldedNoteRecord[];
  walletAddress: string;
  isLoading?: boolean;
  statusMessage?: string;
  // Token filter
  tokenType: 'SOL' | 'NOC';
  // Callback to perform consolidation
  onConsolidate: (selectedNotes: ShieldedNoteRecord[]) => Promise<void>;
  // Optional: Called after successful consolidation
  onSuccess?: () => void;
}

const themeColor = '#8b5cf6'; // Purple for shielded mode

export function ConsolidateModal({
  isOpen,
  onClose,
  shieldedNotes,
  walletAddress,
  isLoading = false,
  statusMessage = '',
  tokenType,
  onConsolidate,
  onSuccess,
}: ConsolidateModalProps) {
  const [selectedNotes, setSelectedNotes] = useState<string[]>([]); // Store nullifiers
  const [showSuccess, setShowSuccess] = useState(false);
  const [consolidateError, setConsolidateError] = useState<string>('');

  if (!isOpen) return null;

  // Filter available notes
  const availableNotes = shieldedNotes.filter(n => 
    !n.spent && 
    n.owner === walletAddress && 
    n.tokenType === tokenType
  );

  const decimals = tokenType === 'SOL' ? 9 : 6;

  // Format note amount
  const formatAmount = (atomsStr: string) => {
    const atoms = BigInt(atomsStr);
    const amount = Number(atoms) / Math.pow(10, decimals);
    return amount.toFixed(decimals === 9 ? 6 : 2);
  };

  // Toggle note selection
  const toggleNoteSelection = useCallback((nullifier: string) => {
    setSelectedNotes(prev => 
      prev.includes(nullifier) 
        ? prev.filter(n => n !== nullifier)
        : [...prev, nullifier]
    );
  }, []);

  // Select all
  const selectAll = useCallback(() => {
    if (selectedNotes.length === availableNotes.length) {
      setSelectedNotes([]);
    } else {
      setSelectedNotes(availableNotes.map(n => n.nullifier));
    }
  }, [selectedNotes, availableNotes]);

  // Handle consolidation
  const handleConsolidate = async () => {
    if (selectedNotes.length < 2) {
      setConsolidateError('Select at least 2 notes to consolidate');
      return;
    }

    try {
      setConsolidateError('');
      const notesToConsolidate = availableNotes.filter(n => 
        selectedNotes.includes(n.nullifier)
      );

      await onConsolidate(notesToConsolidate);
      setShowSuccess(true);
      setSelectedNotes([]);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Consolidation failed';
      setConsolidateError(errorMsg);
    }
  };

  // Calculate totals
  const totalSelected = selectedNotes.reduce((sum, nullifier) => {
    const note = availableNotes.find(n => n.nullifier === nullifier);
    return sum + (note ? BigInt(note.amount) : 0n);
  }, 0n);

  const totalSelectedFormatted = (Number(totalSelected) / Math.pow(10, decimals)).toFixed(
    decimals === 9 ? 6 : 2
  );

  const totalAvailable = availableNotes.reduce((sum, n) => sum + BigInt(n.amount), 0n);
  const totalAvailableFormatted = (Number(totalAvailable) / Math.pow(10, decimals)).toFixed(
    decimals === 9 ? 6 : 2
  );

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur flex items-center justify-center px-4 z-50">
      <div 
        className="bg-[#1a1f3a] rounded-2xl max-w-lg w-full border p-6 space-y-4 relative overflow-hidden"
        style={{ borderColor: `${themeColor}40` }}
      >
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={themeColor} strokeWidth="2">
                <path d="M3 7v6c0 6 8 8 8 8s8-2 8-8V7M3 7l9-5 9 5"/>
              </svg>
              Consolidate Notes
            </h2>
            <p className="text-sm text-neutral-400 mt-1">Merge multiple notes into fewer notes while keeping them private</p>
          </div>
          <button 
            onClick={onClose} 
            className="text-neutral-400 hover:text-white transition p-1"
            disabled={isLoading}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Summary */}
        <div 
          className="p-3 rounded-lg text-sm space-y-2"
          style={{ backgroundColor: `${themeColor}10`, border: `1px solid ${themeColor}20` }}
        >
          <div className="flex justify-between">
            <span className="text-neutral-400">Available notes:</span>
            <span className="text-white font-semibold">{availableNotes.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-400">Total {tokenType}:</span>
            <span style={{ color: themeColor }} className="font-semibold">
              {totalAvailableFormatted} {tokenType}
            </span>
          </div>
          {selectedNotes.length > 0 && (
            <div className="flex justify-between pt-2 border-t" style={{ borderColor: `${themeColor}20` }}>
              <span className="text-neutral-400">Selected to merge:</span>
              <span style={{ color: themeColor }} className="font-semibold">
                {selectedNotes.length} notes ({totalSelectedFormatted} {tokenType})
              </span>
            </div>
          )}
        </div>

        {/* Notes List */}
        <div className="space-y-2">
          <div className="flex justify-between items-center px-2">
            <span className="text-sm text-neutral-400">Your {tokenType} notes</span>
            {availableNotes.length > 1 && (
              <button
                onClick={selectAll}
                className="text-xs px-2 py-1 rounded transition"
                style={{
                  backgroundColor: selectedNotes.length === availableNotes.length ? `${themeColor}30` : `${themeColor}15`,
                  color: themeColor,
                }}
              >
                {selectedNotes.length === availableNotes.length ? 'Deselect All' : 'Select All'}
              </button>
            )}
          </div>

          <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
            {availableNotes.length === 0 ? (
              <div className="text-center py-6 text-neutral-500">
                No notes available to consolidate
              </div>
            ) : (
              availableNotes.map(note => (
                <div
                  key={note.nullifier}
                  className="p-3 rounded-lg border cursor-pointer transition"
                  style={{
                    backgroundColor: selectedNotes.includes(note.nullifier) ? `${themeColor}15` : '#0d1225',
                    borderColor: selectedNotes.includes(note.nullifier) 
                      ? themeColor 
                      : `${themeColor}20`,
                  }}
                  onClick={() => toggleNoteSelection(note.nullifier)}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={selectedNotes.includes(note.nullifier)}
                      onChange={() => toggleNoteSelection(note.nullifier)}
                      className="w-4 h-4 rounded"
                      style={{ accentColor: themeColor }}
                    />
                    <div className="flex-1">
                      <div className="font-semibold text-white">
                        {formatAmount(note.amount)} {tokenType}
                      </div>
                      <div className="text-xs text-neutral-500">
                        {note.nullifier.slice(0, 12)}...
                      </div>
                    </div>
                    <div className="text-right">
                      <div 
                        className="text-sm font-semibold"
                        style={{ color: themeColor }}
                      >
                        {formatAmount(note.amount)} {tokenType}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Error Message */}
        {consolidateError && (
          <div className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg p-3">
            {consolidateError}
          </div>
        )}

        {/* Info Box */}
        <div 
          className="text-xs p-3 rounded-lg"
          style={{ backgroundColor: `${themeColor}10`, border: `1px solid ${themeColor}20` }}
        >
          <p style={{ color: themeColor }}>
            <strong>How it works:</strong> Your selected notes are merged into one or more consolidated notes. All tokens stay in your shielded vault. No amount is lost.
          </p>
        </div>

        {/* Status Message */}
        {statusMessage && (
          <div 
            className="text-sm rounded-lg flex items-center gap-2 p-3"
            style={{ backgroundColor: `${themeColor}15`, color: themeColor }}
          >
            <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" strokeOpacity="0.25"/>
              <path d="M12 2a10 10 0 0 1 10 10" strokeOpacity="1"/>
            </svg>
            {statusMessage}
          </div>
        )}

        {/* Consolidate Button */}
        <button
          onClick={handleConsolidate}
          disabled={isLoading || selectedNotes.length < 2}
          className="w-full rounded-xl font-semibold py-3 transition disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ 
            backgroundColor: isLoading || selectedNotes.length < 2 ? '#4a5568' : themeColor,
            color: isLoading || selectedNotes.length < 2 ? '#a0aec0' : '#fff'
          }}
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" strokeOpacity="0.25"/>
                <path d="M12 2a10 10 0 0 1 10 10" strokeOpacity="1"/>
              </svg>
              Consolidating...
            </span>
          ) : (
            `Consolidate ${selectedNotes.length} Note${selectedNotes.length !== 1 ? 's' : ''} → 1 Note`
          )}
        </button>
      </div>

      {/* Success Modal Overlay */}
      {showSuccess && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm rounded-2xl flex items-center justify-center z-10">
          <div className="text-center p-6 space-y-4">
            {/* Success Icon */}
            <div 
              className="w-20 h-20 mx-auto rounded-full flex items-center justify-center"
              style={{ backgroundColor: `${themeColor}20`, border: `3px solid ${themeColor}` }}
            >
              <svg 
                width="40" 
                height="40" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke={themeColor}
                strokeWidth="3"
                strokeLinecap="round" 
                strokeLinejoin="round"
              >
                <path d="M20 6L9 17l-5-5"/>
              </svg>
            </div>

            {/* Title */}
            <h3 className="text-2xl font-bold text-white">Consolidation Complete!</h3>

            {/* Details */}
            <div className="space-y-2 text-gray-300">
              <p>
                Your {selectedNotes.length} notes have been merged into {Math.max(1, Math.ceil(selectedNotes.length / 8))} consolidated note(s).
              </p>
              <p style={{ color: themeColor }} className="font-semibold">
                All {totalSelectedFormatted} {tokenType} preserved in your shielded vault.
              </p>
            </div>

            {/* Subtext */}
            <p className="text-gray-400 text-sm">Your notes are ready. You can now return to swap.</p>

            {/* Close Button */}
            <button
              onClick={() => {
                setShowSuccess(false);
                onSuccess?.();
                onClose();
              }}
              className="mt-4 px-8 py-3 rounded-xl font-semibold text-lg transition hover:opacity-90"
              style={{ backgroundColor: themeColor, color: '#fff' }}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default ConsolidateModal;
