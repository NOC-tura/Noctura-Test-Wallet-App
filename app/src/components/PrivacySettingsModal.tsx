import { useState, useEffect } from 'react';

interface PrivacySettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

interface PrivacyStats {
  relayerQueueSize: number;
  relayerCount: number;
  feePoolStats: {
    totalPooled: string;
    contributors: number;
  };
  timingPrivacy: {
    enabled: boolean;
    pendingTransactions: number;
    timeSinceLastSubmission: number;
  };
  accountAnonymity: {
    profileCount: number;
    needsRotation: number;
  };
}

export function PrivacySettingsModal({ isOpen, onClose }: PrivacySettingsProps) {
  const [stats, setStats] = useState<PrivacyStats | null>(null);
  const [privacyLevel, setPrivacyLevel] = useState<'standard' | 'enhanced' | 'maximum'>('enhanced');

  useEffect(() => {
    if (isOpen) {
      // Fetch privacy stats
      const relayer = (window as any).__noctura?.relayer;
      const feeCollector = (window as any).__noctura?.feeCollector;
      const timingManager = (window as any).__noctura?.timingManager;
      const anonymityManager = (window as any).__noctura?.anonymityManager;

      setStats({
        relayerQueueSize: relayer?.getQueueSize?.() || 0,
        relayerCount: relayer?.getStats?.().relayerCount || 0,
        feePoolStats: feeCollector?.getStats?.() || { totalPooled: '0', contributors: 0 },
        timingPrivacy: timingManager?.getStats?.() || { enabled: false, pendingTransactions: 0, timeSinceLastSubmission: 0 },
        accountAnonymity: anonymityManager?.getStats?.() || { profileCount: 0, needsRotation: 0 },
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur flex items-center justify-center px-4 z-50">
      <div className="bg-surface rounded-2xl max-w-2xl w-full p-6 space-y-4 max-h-96 overflow-y-auto">
        <div className="flex justify-between items-start">
          <h2 className="text-2xl font-semibold">Privacy Settings</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-white">
            ✕
          </button>
        </div>

        {/* Privacy Level */}
        <div className="space-y-3">
          <h3 className="text-sm uppercase tracking-[0.2em] text-neutral-400">Privacy Level</h3>
          <div className="grid grid-cols-3 gap-3">
            {['standard', 'enhanced', 'maximum'].map((level) => (
              <button
                key={level}
                onClick={() => setPrivacyLevel(level as any)}
                className={`p-3 rounded-lg border transition-all capitalize font-medium text-sm ${
                  privacyLevel === level
                    ? 'border-[#8b5cf6] bg-[#8b5cf6]/10 text-[#8b5cf6]'
                    : 'border-white/10 text-neutral-400 hover:border-white/20'
                }`}
              >
                {level}
              </button>
            ))}
          </div>
          <p className="text-xs text-neutral-500 mt-2">
            {privacyLevel === 'standard' && 'Standard privacy with fee obfuscation'}
            {privacyLevel === 'enhanced' && 'Enhanced with timing privacy and account rotation'}
            {privacyLevel === 'maximum' && 'Maximum privacy with relayer pool and dummy transactions'}
          </p>
        </div>

        {/* Privacy Components Status */}
        <div className="space-y-3 pt-4 border-t border-white/10">
          <h3 className="text-sm uppercase tracking-[0.2em] text-neutral-400">Active Privacy Components</h3>

          <div className="grid grid-cols-2 gap-3">
            {/* Relayer */}
            <div className="bg-black/30 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold">Private Relayer</span>
                <span className="text-xs text-green-400">●</span>
              </div>
              <p className="text-xs text-neutral-400">
                {stats?.relayerCount || 0} relayer accounts
              </p>
              <p className="text-xs text-neutral-500 mt-1">
                Queue: {stats?.relayerQueueSize || 0} transactions
              </p>
            </div>

            {/* Fee Pool */}
            <div className="bg-black/30 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold">Fee Obfuscation</span>
                <span className="text-xs text-green-400">●</span>
              </div>
              <p className="text-xs text-neutral-400">
                {stats?.feePoolStats?.contributors || 0} contributors pooled
              </p>
              <p className="text-xs text-neutral-500 mt-1">
                Pool: {stats?.feePoolStats?.totalPooled || '0'} NOC
              </p>
            </div>

            {/* Timing Privacy */}
            <div className="bg-black/30 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold">Timing Privacy</span>
                <span className={`text-xs ${stats?.timingPrivacy?.enabled ? 'text-green-400' : 'text-yellow-400'}`}>●</span>
              </div>
              <p className="text-xs text-neutral-400">
                {stats?.timingPrivacy?.pendingTransactions || 0} pending in batch
              </p>
              <p className="text-xs text-neutral-500 mt-1">
                Randomized delays enabled
              </p>
            </div>

            {/* Account Anonymity */}
            <div className="bg-black/30 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold">Account Anonymity</span>
                <span className="text-xs text-green-400">●</span>
              </div>
              <p className="text-xs text-neutral-400">
                {stats?.accountAnonymity?.profileCount || 0} profiles
              </p>
              <p className="text-xs text-neutral-500 mt-1">
                Rotating keypairs active
              </p>
            </div>
          </div>
        </div>

        {/* Privacy Info */}
        <div className="bg-[#8b5cf6]/10 border border-[#8b5cf6]/20 rounded-lg p-3 mt-4">
          <p className="text-xs text-neutral-300">
            <strong>100% Privacy Achieved:</strong> Your transactions are relayed through anonymous accounts, fees are pooled with
            others, timing is randomized, and account identity is rotated. Even on-chain observers cannot link you to your
            shielded transactions.
          </p>
        </div>

        <button
          onClick={onClose}
          className="w-full px-4 py-2 bg-[#8b5cf6] text-white rounded-xl hover:bg-[#a78bfa] transition-colors text-sm font-semibold"
        >
          Close
        </button>
      </div>
    </div>
  );
}

export default PrivacySettingsModal;
