import React from 'react';

export default function HowToUseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60">
      <div className="bg-[#101a2f] rounded-2xl shadow-xl p-8 max-w-lg w-full border-2 border-[#00f0ff] relative">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-[#00f0ff] hover:text-white text-2xl font-bold"
          aria-label="Close"
        >
          ×
        </button>
        <h2 className="text-2xl font-bold mb-4 text-[#00f0ff]">How to Use Noctura Wallet</h2>
        <ol className="list-decimal pl-5 space-y-4 text-[#b3e6ff]">
          <li>
            <span className="font-semibold text-[#00f0ff]">Shield Funds (Move to Private Balance):</span><br />
            Go to <span className="text-[#00f0ff]">Transparent</span> tab, click <span className="text-[#00f0ff]">Shield</span>, enter amount, and confirm. Funds appear in <span className="text-[#00f0ff]">Shielded</span> tab.
          </li>
          <li>
            <span className="font-semibold text-[#00f0ff]">Send from Shielded to Transparent:</span><br />
            In <span className="text-[#00f0ff]">Shielded</span> tab, click <span className="text-[#00f0ff]">Send</span>, enter your wallet address (top right) or any Solana address, amount, and confirm. Funds move to transparent balance.
          </li>
          <li>
            <span className="font-semibold text-[#00f0ff]">Send from Shielded to Shielded (Private Transfer):</span><br />
            In <span className="text-[#00f0ff]">Shielded</span> tab, click <span className="text-[#00f0ff]">Send</span>, enter your friend’s <span className="text-[#00f0ff]">shielded address</span> (top right in their wallet), amount, and confirm. To test, open a new wallet in a different browser or incognito window, or ask a friend for their shielded address.
          </li>
        </ol>
        <div className="mt-6 text-center text-[#00f0ff] font-semibold">Always double-check addresses before sending!</div>
      </div>
    </div>
  );
}
