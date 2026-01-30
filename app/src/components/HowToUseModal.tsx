import React, { useState } from 'react';

export default function HowToUseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<'basics' | 'transfers' | 'recovery' | 'fees'>('basics');
  
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60">
      <div className="bg-[#101a2f] rounded-2xl shadow-xl p-6 max-w-2xl w-full border-2 border-[#00f0ff] relative max-h-[90vh] overflow-hidden flex flex-col mx-4">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-[#00f0ff] hover:text-white text-2xl font-bold"
          aria-label="Close"
        >
          ×
        </button>
        <h2 className="text-2xl font-bold mb-4 text-[#00f0ff]">How to Use Noctura Wallet</h2>
        
        {/* Tab Navigation */}
        <div className="flex gap-2 mb-4 flex-wrap">
          {[
            { id: 'basics', label: '📖 Basics' },
            { id: 'transfers', label: '💸 Transfers' },
            { id: 'recovery', label: '🔑 Recovery' },
            { id: 'fees', label: '💰 Fees' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                activeTab === tab.id
                  ? 'bg-[#00f0ff] text-[#101a2f]'
                  : 'bg-[#1a2744] text-[#b3e6ff] hover:bg-[#243554]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        
        {/* Scrollable Content */}
        <div className="overflow-y-auto flex-1 pr-2">
          {/* Basics Tab */}
          {activeTab === 'basics' && (
            <div className="space-y-4 text-[#b3e6ff]">
              <div className="bg-[#1a2744] rounded-xl p-4">
                <h3 className="font-semibold text-[#00f0ff] mb-2">🔓 Transparent Mode</h3>
                <p className="text-sm">
                  Standard Solana transactions. Balances and transfers are visible on the blockchain explorer. 
                  Use this for receiving funds from exchanges or sending to friends who need visible transactions.
                </p>
              </div>
              
              <div className="bg-[#1a2744] rounded-xl p-4">
                <h3 className="font-semibold text-[#8b5cf6] mb-2">🔒 Shielded Mode</h3>
                <p className="text-sm">
                  Private transactions using zero-knowledge proofs. Your sender identity, recipient, and amounts 
                  are hidden from the blockchain. Perfect for privacy-focused transfers.
                </p>
              </div>
              
              <div className="bg-[#1a2744] rounded-xl p-4">
                <h3 className="font-semibold text-[#00f0ff] mb-2">🛡️ What is Shielding?</h3>
                <p className="text-sm mb-2">
                  Shielding moves your NOC tokens from your transparent (public) balance into your 
                  private shielded vault. Once shielded, your funds become invisible on the blockchain.
                </p>
                <p className="text-sm text-[#a3d4ff]">
                  <strong>Think of it like:</strong> Depositing cash into a private safe that only you can access.
                </p>
              </div>
              
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
                <h3 className="font-semibold text-amber-300 mb-2">💡 Quick Tip</h3>
                <p className="text-sm text-amber-200">
                  Toggle between modes using the <span className="text-[#00f0ff]">Transparent</span> / 
                  <span className="text-[#8b5cf6]"> Shielded</span> buttons at the top of your wallet.
                </p>
              </div>
            </div>
          )}
          
          {/* Transfers Tab */}
          {activeTab === 'transfers' && (
            <div className="space-y-4 text-[#b3e6ff]">
              <div className="bg-[#1a2744] rounded-xl p-4">
                <h3 className="font-semibold text-[#00f0ff] mb-2">Step 1: Shield Your Funds</h3>
                <ol className="text-sm space-y-2 list-decimal list-inside">
                  <li>Switch to <span className="text-[#00f0ff]">Transparent</span> mode</li>
                  <li>Click the <span className="text-[#00f0ff]">Shield</span> button</li>
                  <li>Enter the amount of NOC to shield</li>
                  <li>Confirm the transaction</li>
                  <li>Your funds will appear in <span className="text-[#8b5cf6]">Shielded</span> mode</li>
                </ol>
              </div>
              
              <div className="bg-[#1a2744] rounded-xl p-4">
                <h3 className="font-semibold text-[#8b5cf6] mb-2">Step 2: Send Privately (Shielded to Shielded)</h3>
                <ol className="text-sm space-y-2 list-decimal list-inside">
                  <li>Switch to <span className="text-[#8b5cf6]">Shielded</span> mode</li>
                  <li>Click <span className="text-[#8b5cf6]">Send</span></li>
                  <li>Enter recipient shielded address (starts with noctura1...)</li>
                  <li>Enter amount and confirm</li>
                </ol>
                <p className="text-xs text-green-400 mt-2">
                  ✨ This is FULLY PRIVATE - sender, receiver, and amount are all hidden!
                </p>
              </div>
              
              <div className="bg-[#1a2744] rounded-xl p-4">
                <h3 className="font-semibold text-[#00f0ff] mb-2">Step 3: Withdraw to Transparent</h3>
                <ol className="text-sm space-y-2 list-decimal list-inside">
                  <li>In <span className="text-[#8b5cf6]">Shielded</span> mode, click <span className="text-[#8b5cf6]">Send</span></li>
                  <li>Enter any Solana address (your own or someone elses)</li>
                  <li>The funds will appear in the transparent balance</li>
                </ol>
                <p className="text-xs text-amber-400 mt-2">
                  ⚠️ Note: Withdrawing to a transparent address reveals the amount publicly.
                </p>
              </div>
              
              <div className="bg-[#1a2744] rounded-xl p-4">
                <h3 className="font-semibold text-[#00f0ff] mb-2">📬 Receiving Shielded Funds</h3>
                <p className="text-sm mb-2">
                  Share your <strong>shielded address</strong> (visible in Shielded mode, top-right) with the sender. 
                  Funds sent to this address are automatically detected by your wallet.
                </p>
                <p className="text-xs text-[#a3d4ff]">
                  Your shielded address starts with noctura1...
                </p>
              </div>
            </div>
          )}
          
          {/* Recovery Tab */}
          {activeTab === 'recovery' && (
            <div className="space-y-4 text-[#b3e6ff]">
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
                <h3 className="font-semibold text-red-400 mb-2">⚠️ CRITICAL: Save Your Recovery Phrase</h3>
                <p className="text-sm text-red-200 mb-2">
                  Your 12-word recovery phrase is the <strong>ONLY WAY</strong> to recover your wallet if you:
                </p>
                <ul className="text-sm text-red-200 list-disc list-inside space-y-1">
                  <li>Log out of the wallet</li>
                  <li>Clear your browser data/cookies</li>
                  <li>Switch to a new device</li>
                  <li>Reinstall your browser</li>
                </ul>
              </div>
              
              <div className="bg-[#1a2744] rounded-xl p-4">
                <h3 className="font-semibold text-[#00f0ff] mb-2">📝 How to Backup</h3>
                <ol className="text-sm space-y-2 list-decimal list-inside">
                  <li>When you create a wallet, you are shown 12 words</li>
                  <li><strong>Write them down on paper</strong> (in order!)</li>
                  <li>Store in a safe, secure location</li>
                  <li>Never share with anyone</li>
                  <li>Never store digitally (no screenshots, no notes apps)</li>
                </ol>
              </div>
              
              <div className="bg-[#1a2744] rounded-xl p-4">
                <h3 className="font-semibold text-[#00f0ff] mb-2">🔄 How to Restore Your Wallet</h3>
                <ol className="text-sm space-y-2 list-decimal list-inside">
                  <li>Open Noctura Wallet</li>
                  <li>Click <span className="text-[#00f0ff]">Import Existing Wallet</span></li>
                  <li>Enter your 12-word recovery phrase</li>
                  <li>Click Restore Wallet</li>
                  <li>Your wallet (including shielded funds) will be restored!</li>
                </ol>
              </div>
              
              <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4">
                <h3 className="font-semibold text-green-400 mb-2">✅ Good News About Shielded Funds</h3>
                <p className="text-sm text-green-200">
                  Your shielded balance is tied to your recovery phrase! When you restore your wallet 
                  using your 12 words, all your private shielded funds will be accessible again.
                </p>
              </div>
            </div>
          )}
          
          {/* Fees Tab */}
          {activeTab === 'fees' && (
            <div className="space-y-4 text-[#b3e6ff]">
              <div className="bg-[#1a2744] rounded-xl p-4">
                <h3 className="font-semibold text-[#00f0ff] mb-2">💰 Fee Structure</h3>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between items-center border-b border-white/10 pb-2">
                    <span>Transparent Send (SOL/NOC)</span>
                    <span className="text-[#00f0ff]">~0.000005 SOL</span>
                  </div>
                  <div className="flex justify-between items-center border-b border-white/10 pb-2">
                    <span>Shield Deposit</span>
                    <span className="text-[#8b5cf6]">0.25 NOC + ~0.000005 SOL</span>
                  </div>
                  <div className="flex justify-between items-center border-b border-white/10 pb-2">
                    <span>Private Send (Shielded to Shielded)</span>
                    <span className="text-[#8b5cf6]">0.25 NOC</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Withdraw (Shielded to Transparent)</span>
                    <span className="text-[#8b5cf6]">0.25 NOC</span>
                  </div>
                </div>
              </div>
              
              <div className="bg-[#1a2744] rounded-xl p-4">
                <h3 className="font-semibold text-[#00f0ff] mb-2">❓ Why Privacy Fees?</h3>
                <p className="text-sm mb-2">
                  The 0.25 NOC privacy fee covers the cost of generating and verifying zero-knowledge proofs 
                  that keep your transactions private. This fee supports the relayer network that processes 
                  your private transactions.
                </p>
              </div>
              
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
                <h3 className="font-semibold text-amber-300 mb-2">💡 Before You Send</h3>
                <p className="text-sm text-amber-200">
                  Make sure you have enough balance to cover both the amount AND the fees:
                </p>
                <ul className="text-sm text-amber-200 list-disc list-inside mt-2 space-y-1">
                  <li><strong>Transparent sends:</strong> Need small SOL for network fee</li>
                  <li><strong>Shielded operations:</strong> Need 0.25 NOC + small SOL</li>
                </ul>
              </div>
            </div>
          )}
        </div>
        
        <div className="mt-4 pt-4 border-t border-[#00f0ff]/20 text-center text-[#00f0ff] font-semibold">
          Always double-check addresses before sending!
        </div>
      </div>
    </div>
  );
}
