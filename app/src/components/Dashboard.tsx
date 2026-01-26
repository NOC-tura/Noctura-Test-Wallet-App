/* eslint-disable @typescript-eslint/no-unused-vars, no-unused-vars */
import React from 'react';
import { useCallback, useState, useRef, useEffect } from 'react';
import QRCode from 'qrcode';
import '../styles/dashboard.css';
import HowToUseModal from './HowToUseModal';
import { WalletSelector } from './WalletSelector';

interface WalletBalance {
  transparentSol: number;
  transparentNoc: number;
  shieldedSol: number;
  shieldedNoc: number;
}

interface DashboardProps {
  mode: 'transparent' | 'shielded';
  solBalance: number;
  nocBalance: number;
  shieldedSolBalance: number;
  shieldedNocBalance: number;
  walletAddress: string;
  shieldedAddress?: string; // New: noctura1... format for private transfers
  onModeChange: (mode: 'transparent' | 'shielded') => void;
  onReceive: () => void;
  onSend: () => void;
  onShield: () => void;
  onSendTransaction?: (token: 'SOL' | 'NOC', amount: string, recipient: string) => void;
  onRequestSolFaucet?: () => void;
  onFetchTransactions?: () => Promise<Array<{ signature: string; slot: number; timestamp: number; err: any; memo?: string }>>;
  onShieldDeposit?: (token: 'SOL' | 'NOC', amount: string) => void;
  /** Optional callback when wallet is switched */
  onWalletSwitch?: () => void;
  /** Optional balances for all wallets (keyed by public address) */
  walletBalances?: Record<string, WalletBalance>;
}

export function Dashboard({
  mode,
  solBalance,
  nocBalance,
  shieldedSolBalance,
  shieldedNocBalance,
  walletAddress,
  shieldedAddress,
  onModeChange,
  onReceive,
  onSend,
  onShield,
  onSendTransaction,
  onRequestSolFaucet,
  onFetchTransactions,
  onShieldDeposit,
  onWalletSwitch,
  walletBalances = {},
}: DashboardProps) {
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [showSendModal, setShowSendModal] = useState(false);
  const [showActivityModal, setShowActivityModal] = useState(false);
  const [showShieldModal, setShowShieldModal] = useState(false);
  const [showPrivacySettings, setShowPrivacySettings] = useState(false);
  const [transactions, setTransactions] = useState<Array<{ signature: string; slot: number; timestamp: number; err: any; memo?: string }>>([]);
  const [loadingTransactions, setLoadingTransactions] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [copiedShieldedAddress, setCopiedShieldedAddress] = useState(false);
  const [sendToken, setSendToken] = useState<'SOL' | 'NOC'>('SOL');
  const [sendAmount, setSendAmount] = useState('');
  const [sendRecipient, setSendRecipient] = useState('');
  const [shieldToken, setShieldToken] = useState<'SOL' | 'NOC'>('SOL');
  const [shieldAmount, setShieldAmount] = useState('');
  const [howToUseOpen, setHowToUseOpen] = useState(false);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);
  const qrShieldedCanvasRef = useRef<HTMLCanvasElement>(null);

  const isTransparent = mode === 'transparent';

  // Generate QR code when modal opens or address changes
  useEffect(() => {
    if (showReceiveModal && qrCanvasRef.current && walletAddress) {
      console.log('Generating QR code for:', walletAddress);
      QRCode.toCanvas(qrCanvasRef.current, walletAddress, {
        width: 200,
        color: {
          dark: '#00f0ff',
          light: '#0a0e27',
        },
        margin: 1,
        errorCorrectionLevel: 'H',
      }).then(() => {
        console.log('QR code generated successfully');
      }).catch((err: unknown) => {
        console.error('QR code generation error:', err);
      });
    }
    
    // Generate QR for shielded address in shielded mode
    if (showReceiveModal && qrShieldedCanvasRef.current && shieldedAddress && !isTransparent) {
      QRCode.toCanvas(qrShieldedCanvasRef.current, shieldedAddress, {
        width: 200,
        color: {
          dark: '#8b5cf6',
          light: '#0a0e27',
        },
        margin: 1,
        errorCorrectionLevel: 'H',
      }).catch((err: unknown) => {
        console.error('Shielded QR code generation error:', err);
      });
    }
  }, [showReceiveModal, walletAddress, shieldedAddress, isTransparent]);
  
  // Theme colors based on mode
  const themeColor = isTransparent ? '#00f0ff' : '#8b5cf6'; // cyan for transparent, purple for shielded
  const themeBorder = isTransparent ? 'border-[#00f0ff]/20' : 'border-[#8b5cf6]/20';
  const themeText = isTransparent ? 'text-[#00f0ff]' : 'text-[#8b5cf6]';
  
  const displaySolBalance = isTransparent ? solBalance : shieldedSolBalance;
  const displayNocBalance = isTransparent ? nocBalance : shieldedNocBalance;
  const totalUsd = displaySolBalance * 129.74 + displayNocBalance * 0.5; // Mock prices
  
  const handleCopyAddress = useCallback(() => {
    navigator.clipboard.writeText(walletAddress);
    setCopiedAddress(true);
    setTimeout(() => setCopiedAddress(false), 2000);
  }, [walletAddress]);

  const handleReceiveClick = useCallback(() => {
    // Allow receiving in both transparent and shielded mode
    setShowReceiveModal(true);
    onReceive();
  }, [onReceive]);

  const handleSendClick = useCallback(() => {
    setShowSendModal(true);
    onSend();
  }, [onSend]);

  const handleShieldClick = useCallback(() => {
    if (isTransparent) {
      setShowShieldModal(true);
    }
  }, [isTransparent]);

  const sendDisabled = !sendAmount || !sendRecipient || isNaN(parseFloat(sendAmount));

  return (
    <>
      {/* HOW TO USE Button - hidden on mobile, visible on md+ */}
      <div className="hidden md:flex fixed left-1/2 top-8 z-40 -translate-x-1/2 items-center justify-center">
        <button
          className="px-4 py-1.5 rounded-lg bg-[#101a2f] border-2 border-[#00f0ff] text-[#00f0ff] font-bold shadow-lg hover:bg-[#00f0ff] hover:text-[#101a2f] transition text-base"
          style={{ letterSpacing: '0.08em', minWidth: 120 }}
          onClick={() => setHowToUseOpen(true)}
        >
          HOW TO USE
        </button>
      </div>

      <div className="flex h-screen bg-[#0a0e27]" style={{ '--theme-color': themeColor } as React.CSSProperties}>
        {/* Sidebar - hidden on mobile */}
        <div className="sidebar hidden md:flex">
          {/* Logo at top */}
          <div className="sidebar-logo mb-4">
            <img src="/NOC2.png" alt="Noctura" className="w-10 h-10 rounded-full" />
          </div>
          
          <div className="sidebar-icon" title="Portfolio">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={themeColor} strokeWidth="2">
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
              <path d="M16 4H8a2 2 0 0 0-2 2v2h12V6a2 2 0 0 0-2-2z"/>
              <circle cx="9" cy="14" r="1.5"/>
            </svg>
          </div>
          <div className="sidebar-icon" title="Activity" onClick={async () => {
            if (onFetchTransactions) {
              setShowActivityModal(true);
              setLoadingTransactions(true);
              try {
                const txs = await onFetchTransactions();
                setTransactions(txs);
              } catch (err) {
                console.error('Failed to fetch transactions:', err);
              } finally {
                setLoadingTransactions(false);
              }
            }
          }} style={{ cursor: onFetchTransactions ? 'pointer' : 'default' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={themeColor} strokeWidth="2">
              <path d="M3 12h18M3 6h18M3 18h18"/>
              <rect x="1" y="3" width="22" height="18" rx="2" ry="2"/>
            </svg>
          </div>
          <div className="sidebar-icon" title="Settings" onClick={() => setShowPrivacySettings(true)} style={{ cursor: 'pointer' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={themeColor} strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 1v6m0 6v6M4.22 4.22l4.24 4.24m5.08 5.08l4.24 4.24M1 12h6m6 0h6M4.22 19.78l4.24-4.24m5.08-5.08l4.24-4.24"/>
            </svg>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 dashboard-bg relative overflow-y-auto">
          <div className="relative z-10 p-2 md:p-4 pt-2 flex flex-col min-h-full pb-20 md:pb-4">
            {/* Header - higher z-index to ensure dropdown appears above balance card */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 mb-2 relative z-[200]">
              {/* Left: Logo + Title - smaller on mobile */}
              <div className="flex items-center gap-2 md:gap-4 w-full md:w-auto justify-between md:justify-start">
                <h1 className="text-xl md:text-2xl font-bold text-white flex items-center gap-2 md:gap-4">
                  <img src="/NOC1.png" alt="Noctura" className="h-16 md:h-36 w-auto" />
                  <span className="text-2xl md:text-4xl" style={{ marginTop: '-5px' }}>Wallet</span>
                </h1>
                {/* Mobile HOW TO USE button */}
                <button
                  className="md:hidden px-2 py-1 rounded-lg bg-[#101a2f] border border-[#00f0ff] text-[#00f0ff] text-xs font-bold"
                  onClick={() => setHowToUseOpen(true)}
                >
                  ?
                </button>
              </div>

              {/* Right: Wallet Selector + Address with Copy */}
              <div className={`flex items-center gap-2 md:gap-3 bg-[#1a1f3a]/60 backdrop-blur-md border ${themeBorder} rounded-xl px-2 md:px-4 py-2 w-full md:w-auto`}>
                {/* Multi-Wallet Selector */}
                <WalletSelector 
                  themeColor={themeColor}
                  onWalletSwitch={onWalletSwitch}
                  balances={walletBalances}
                  mode={mode}
                />
                
                {/* Address Window - hidden on mobile, shows transparent in transparent mode, shielded in shielded mode */}
                {isTransparent ? (
                  /* Transparent Address Window - hidden on mobile */
                  <div className="hidden md:flex items-center gap-2 bg-[#1a1f3a]/60 backdrop-blur-md border rounded-xl px-3 py-1">
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-xs text-gray-400">wallet</span>
                      <span className={`text-sm font-mono ${themeText}`}>{walletAddress.slice(0, 7)}...{walletAddress.slice(-5)}</span>
                    </div>
                    <button
                      onClick={handleCopyAddress}
                      className="ml-2 p-1.5 hover:bg-[#00f0ff]/10 rounded-lg transition"
                      title="Copy address"
                    >
                      {copiedAddress ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={themeColor} strokeWidth="2">
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={themeColor} strokeWidth="2">
                          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
                          <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
                        </svg>
                      )}
                    </button>
                  </div>
                ) : (
                  /* Shielded Address Window (only in shielded mode) - hidden on mobile */
                  shieldedAddress && (
                    <div className="hidden md:flex items-center gap-2 bg-[#1a1f3a]/60 backdrop-blur-md border rounded-xl px-3 py-1">
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-xs text-gray-400">shielded</span>
                        <span className={`text-sm font-mono ${themeText}`}>{shieldedAddress.slice(0, 10)}...{shieldedAddress.slice(-6)}</span>
                      </div>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(shieldedAddress);
                          setCopiedShieldedAddress(true);
                          setTimeout(() => setCopiedShieldedAddress(false), 2000);
                        }}
                        className="ml-2 p-1.5 hover:bg-[#8b5cf6]/10 rounded-lg transition"
                        title="Copy shielded address"
                      >
                        {copiedShieldedAddress ? (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={themeColor} strokeWidth="2">
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                        ) : (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={themeColor} strokeWidth="2">
                            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
                            <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
                          </svg>
                        )}
                      </button>
                    </div>
                  )
                )}
              </div>
            </div>

            {/* Main Content Grid - lower z-index than header */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 md:gap-4 flex-1 relative z-[10]">
              {/* Left: Balance Card */}
              <div className="lg:col-span-2">
                {/* Mode Toggle - Inside Balance Widget Area */}
                <div className="flex justify-center mb-3">
                  <div className="mode-toggle" style={{ gap: '8px' }}>
                    <button
                      className={`mode-btn ${isTransparent ? 'active' : ''}`}
                      onClick={() => onModeChange('transparent')}
                      style={{ minWidth: '160px', padding: '12px 24px', fontSize: '15px' }}
                    >
                      Transparent
                    </button>
                    <button
                      className={`mode-btn ${!isTransparent ? 'active' : ''}`}
                      onClick={() => onModeChange('shielded')}
                      style={{ 
                        minWidth: '160px', 
                        padding: '12px 24px', 
                        fontSize: '15px',
                        ...(!isTransparent ? {
                          borderColor: '#a855f7',
                          background: 'rgba(168, 85, 247, 0.15)',
                          color: '#a855f7',
                          boxShadow: '0 0 12px rgba(168, 85, 247, 0.3), inset 0 0 8px rgba(168, 85, 247, 0.1)'
                        } : {})
                      }}
                    >
                      Shielded
                    </button>
                  </div>
                </div>
                
                <div className="balance-card" style={{
                  borderColor: `${themeColor}20`,
                  boxShadow: `inset 0 1px 2px rgba(255, 255, 255, 0.1), 0 8px 32px rgba(0, 0, 0, 0.4), 0 0 20px ${themeColor}10`
                }}>
                  <div className="balance-card-content">
                    <div className="balance-subtitle">
                      {isTransparent ? 'Transparent' : 'Shielded'} Balance
                    </div>
                    <div className="balance-value">${totalUsd.toFixed(2)}</div>
                    
                    <div className="balance-tokens">
                      <div className="token-item">
                        <div className="token-label">SOL</div>
                        <div className="token-value" style={{ color: themeColor }}>{displaySolBalance.toFixed(6)}</div>
                      </div>
                      <div className="token-item">
                        <div className="token-label">NOC</div>
                        <div className="token-value" style={{ color: themeColor }}>{displayNocBalance.toFixed(2)}</div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="action-buttons">
                      <button
                        className="action-btn"
                        onClick={handleReceiveClick}
                        title={isTransparent ? 'Receive funds to wallet' : 'Receive private funds to shielded address'}
                        style={{
                          borderColor: `${themeColor}4D`,
                          color: themeColor,
                        }}
                      >
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 5v14M5 12l7 7 7-7"/>
                        </svg>
                        Receive
                      </button>
                      <button
                        className="action-btn"
                        onClick={handleSendClick}
                        title={isTransparent ? 'Send transparently' : 'Send shielded funds'}
                        style={{
                          borderColor: `${themeColor}4D`,
                          color: themeColor,
                        }}
                      >
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 5v14M19 12l-7-7-7 7"/>
                        </svg>
                        Send
                      </button>
                      <button
                        className={`action-btn ${!isTransparent ? 'opacity-50 cursor-not-allowed' : ''}`}
                        onClick={handleShieldClick}
                        disabled={!isTransparent}
                        title={isTransparent ? 'Shield your funds' : 'Already in shielded mode'}
                        style={{
                          borderColor: `${themeColor}4D`,
                          color: themeColor,
                        }}
                      >
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 2L4 6v6c0 6 8 8 8 8s8-2 8-8V6l-8-4z" strokeLinejoin="round"/>
                        </svg>
                        Shield
                      </button>
                      {isTransparent && onRequestSolFaucet && (
                        <button
                          className="action-btn"
                          onClick={onRequestSolFaucet}
                          title="Request devnet SOL from faucet"
                          style={{
                            borderColor: `${themeColor}4D`,
                            color: themeColor,
                          }}
                        >
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10"/>
                            <path d="M12 8v8M8 12h8"/>
                          </svg>
                          Get SOL
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Right: Asset Lists */}
              <div className="space-y-8">
                {/* Tokens Panel */}
                <div>
                  <div className="side-panel-title">Tokens</div>
                  <div className="space-y-3">
                    {/* Always show both transparent and shielded balances in shielded mode, with purple color */}
                    <div className="asset-item">
                      <div className="asset-logo" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '40px', height: '40px' }}>
                        <img src="/sol-logo.png" alt="SOL" style={{ width: '24px', height: '24px', objectFit: 'contain' }} />
                      </div>
                      <div className="asset-info">
                        <div className="asset-name">Solana</div>
                        <div className="asset-symbol">SOL</div>
                      </div>
                      <div className="asset-amount" style={{ color: themeColor }}>{solBalance.toFixed(2)}</div>
                    </div>
                    <div className="asset-item">
                      <img src="/logo3.jpg" alt="NOC" className="asset-logo" style={{ width: '40px', height: '40px', objectFit: 'contain' }} />
                      <div className="asset-info">
                        <div className="asset-name">Noctura</div>
                        <div className="asset-symbol">NOC</div>
                      </div>
                      <div className="asset-amount" style={{ color: themeColor }}>{nocBalance.toFixed(0)}</div>
                    </div>
                  </div>
                </div>

                {/* Shielded Balances Panel */}
                <div>
                  <div className="side-panel-title">Shielded Balances</div>
                  {shieldedSolBalance > 0 || shieldedNocBalance > 0 ? (
                    <div className="space-y-3">
                      {shieldedSolBalance > 0 && (
                        <div className="asset-item">
                          <div className="asset-logo" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '40px', height: '40px', position: 'relative' }}>
                            <img src="/sol-logo.png" alt="wSOL" style={{ width: '24px', height: '24px', objectFit: 'contain' }} />
                            <div className="lock-icon" style={{ position: 'absolute', bottom: '-2px', right: '-2px', fontSize: '14px' }}>🔒</div>
                          </div>
                          <div className="asset-info flex-1">
                            <div className="asset-name">Solana</div>
                            <div className="asset-symbol">wSOL</div>
                          </div>
                          <div className="asset-amount" style={{ color: themeColor }}>{shieldedSolBalance.toFixed(6)}</div>
                        </div>
                      )}
                      {shieldedNocBalance > 0 && (
                        <div className="asset-item">
                          <div className="asset-logo" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '40px', height: '40px', position: 'relative' }}>
                            <img src="/logo3.jpg" alt="NOC" style={{ width: '40px', height: '40px', objectFit: 'contain', borderRadius: '50%' }} />
                            <div className="lock-icon" style={{ position: 'absolute', bottom: '-2px', right: '-2px', fontSize: '14px' }}>🔒</div>
                          </div>
                          <div className="asset-info flex-1">
                            <div className="asset-name">Noctura</div>
                            <div className="asset-symbol">NOC</div>
                          </div>
                          <div className="asset-amount" style={{ color: themeColor }}>{shieldedNocBalance.toFixed(2)}</div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="placeholder">No shielded funds yet</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Receive Modal */}
        {showReceiveModal && (
          <div className="modal-overlay" onClick={() => setShowReceiveModal(false)}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2 className="modal-title">Receive SOL & NOC</h2>
                <button
                  className="modal-close"
                  onClick={() => setShowReceiveModal(false)}
                >
                  ✕
                </button>
              </div>

              {/* Transparent Address - only show in transparent mode */}
              {isTransparent && (
                <>
                  <div className="input-field">
                    <label className="input-label" style={{ color: '#00f0ff' }}>
                      🔓 Transparent Address (Public)
                    </label>
                    <div className="input-wrapper">
                      <input
                        type="text"
                        className="input-box"
                        value={walletAddress}
                        readOnly
                        style={{ paddingRight: '80px', borderColor: '#00f0ff33' }}
                      />
                      <button
                        className="copy-btn"
                        onClick={handleCopyAddress}
                      >
                        {copiedAddress ? '✓ Copied' : 'Copy'}
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Standard Solana address. Transactions are visible on blockchain.
                    </p>
                  </div>

                  {/* QR for transparent address */}
                  <div className="qr-container" style={{ display: 'flex', justifyContent: 'center', margin: '16px 0' }}>
                    <canvas
                      ref={qrCanvasRef}
                      style={{
                        width: 160,
                        height: 160,
                        borderRadius: '12px',
                        border: '2px solid #00f0ff',
                        padding: '8px',
                        backgroundColor: '#0a0e27',
                      }}
                    />
                  </div>
                </>
              )}

              {/* Shielded Address - only show in shielded mode */}
              {!isTransparent && shieldedAddress && (
                <>
                  <div className="input-field" style={{ marginTop: '20px' }}>
                    <label className="input-label" style={{ color: '#8b5cf6' }}>
                      🛡️ Shielded Address (Private)
                    </label>
                    <div className="input-wrapper">
                      <input
                        type="text"
                        className="input-box"
                        value={shieldedAddress}
                        readOnly
                        style={{ paddingRight: '80px', borderColor: '#8b5cf633', fontSize: '12px' }}
                      />
                      <button
                        className="copy-btn"
                        onClick={() => {
                          navigator.clipboard.writeText(shieldedAddress);
                          setCopiedShieldedAddress(true);
                          setTimeout(() => setCopiedShieldedAddress(false), 2000);
                        }}
                        style={{ backgroundColor: '#8b5cf622', borderColor: '#8b5cf6' }}
                      >
                        {copiedShieldedAddress ? '✓ Copied' : 'Copy'}
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      ✨ Private address. Senders encrypt notes - you auto-discover payments!
                    </p>
                  </div>

                  {/* QR for shielded address */}
                  <div className="qr-container" style={{ display: 'flex', justifyContent: 'center', margin: '16px 0' }}>
                    <canvas
                      ref={qrShieldedCanvasRef}
                      style={{
                        width: 160,
                        height: 160,
                        borderRadius: '12px',
                        border: '2px solid #8b5cf6',
                        padding: '8px',
                        backgroundColor: '#0a0e27',
                      }}
                    />
                  </div>
                </>
              )}

              <p className="text-center text-sm text-gray-400 mt-4">
                {isTransparent 
                  ? 'Share this address or QR code to receive funds' 
                  : 'Share shielded address for private transfers, or transparent for public'}
              </p>
            </div>
          </div>
        )}

        {/* Send Modal */}
        {showSendModal && (
          <div className="modal-overlay" onClick={() => setShowSendModal(false)}>
            <div 
              className="modal-card" 
              onClick={(e) => e.stopPropagation()}
              style={{
                borderColor: `${themeColor}33`
              }}
            >
              <div className="modal-header">
                <h2 className="modal-title">Send Funds</h2>
                <button
                  className="modal-close"
                  onClick={() => setShowSendModal(false)}
                  style={{ color: themeColor }}
                >
                  ✕
                </button>
              </div>

              <div className="input-field">
                <label className="input-label">Amount</label>
                <input
                  type="number"
                  className="input-box"
                  placeholder="0.00"
                  value={sendAmount}
                  onChange={(e) => setSendAmount(e.target.value)}
                  style={{
                    borderColor: `${themeColor}33`,
                    color: themeColor
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = themeColor;
                    e.target.style.boxShadow = `0 0 16px ${themeColor}33, inset 0 0 8px ${themeColor}0D`;
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = `${themeColor}33`;
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>

              <div className="input-field">
                <label className="input-label">Token</label>
                <select
                  className="input-box"
                  value={sendToken}
                  onChange={(e) => setSendToken(e.target.value as 'SOL' | 'NOC')}
                  style={{
                    borderColor: `${themeColor}33`,
                    color: themeColor
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = themeColor;
                    e.target.style.boxShadow = `0 0 16px ${themeColor}33, inset 0 0 8px ${themeColor}0D`;
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = `${themeColor}33`;
                    e.target.style.boxShadow = 'none';
                  }}
                >
                  <option value="SOL">Solana (SOL)</option>
                  <option value="NOC">Noctura (NOC)</option>
                </select>
              </div>

              <div className="input-field">
                <label className="input-label">Recipient Address</label>
                <input
                  type="text"
                  className="input-box"
                  placeholder="Paste wallet address"
                  value={sendRecipient}
                  onChange={(e) => setSendRecipient(e.target.value)}
                  style={{
                    borderColor: `${themeColor}33`,
                    color: themeColor
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = themeColor;
                    e.target.style.boxShadow = `0 0 16px ${themeColor}33, inset 0 0 8px ${themeColor}0D`;
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = `${themeColor}33`;
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>

              <button
                className="btn-primary"
                disabled={sendDisabled}
                onClick={() => {
                  if (onSendTransaction && sendAmount && sendRecipient) {
                    onSendTransaction(sendToken, sendAmount, sendRecipient);
                  }
                  setShowSendModal(false);
                  setSendAmount('');
                  setSendRecipient('');
                }}
                style={{
                  borderColor: themeColor,
                  color: themeColor,
                  background: `linear-gradient(90deg, ${themeColor}4D, ${themeColor}26)`
                }}
                onMouseEnter={(e) => {
                  if (!sendDisabled) {
                    e.currentTarget.style.background = `linear-gradient(90deg, ${themeColor}66, ${themeColor}40)`;
                    e.currentTarget.style.boxShadow = `0 0 24px ${themeColor}66, inset 0 0 16px ${themeColor}33`;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!sendDisabled) {
                    e.currentTarget.style.background = `linear-gradient(90deg, ${themeColor}4D, ${themeColor}26)`;
                    e.currentTarget.style.boxShadow = 'none';
                  }
                }}
              >
                Send {sendAmount} {sendToken}
              </button>
            </div>
          </div>
        )}

        {/* Activity Modal */}
        {showActivityModal && (
          <div 
            className="modal-overlay"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowActivityModal(false);
            }}
          >
            <div className="modal-content max-w-2xl">
              <div className="modal-header">
                <h3 className="modal-title">Recent Activity</h3>
                <button 
                  className="modal-close"
                  onClick={() => setShowActivityModal(false)}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </button>
              </div>

              <div className="space-y-2 max-h-96 overflow-y-auto">
                {loadingTransactions ? (
                  <div className="text-center py-8 text-neutral-400">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400 mx-auto mb-2"></div>
                    Loading transactions...
                  </div>
                ) : transactions.length === 0 ? (
                  <div className="text-center py-8 text-neutral-400">
                    No transactions found
                  </div>
                ) : (
                  transactions.map((tx, idx) => {
                    const explorerUrl = `https://explorer.solana.com/tx/${tx.signature}?cluster=devnet`;
                    const date = tx.timestamp ? new Date(tx.timestamp * 1000).toLocaleString() : 'Unknown';
                    const status = tx.err ? 'Failed' : 'Success';
                    const statusColor = tx.err ? 'text-red-400' : 'text-green-400';
                    
                    // Detect transaction type from the type field or memo
                    const txType = (tx as any).type;
                    const txIsShielded = (tx as any).isShielded;
                    
                    // Get icon and label based on transaction type
                    let txTypeIcon = '📤';
                    let txTypeLabel = 'Public';
                    let labelColor = 'bg-neutral-900';
                    
                    if (txType === 'shielded_send') {
                      txTypeIcon = '🔒';
                      txTypeLabel = 'Private Send';
                      labelColor = 'bg-purple-900/50';
                    } else if (txType === 'shielded_receive') {
                      txTypeIcon = '🔐';
                      txTypeLabel = 'Private Receive';
                      labelColor = 'bg-purple-900/50';
                    } else if (txType === 'shield_deposit') {
                      txTypeIcon = '🛡️';
                      txTypeLabel = 'Shield';
                      labelColor = 'bg-violet-900/50';
                    } else if (txType === 'shield_withdraw') {
                      txTypeIcon = '🔓';
                      txTypeLabel = 'Unshield';
                      labelColor = 'bg-violet-900/50';
                    } else if (txType === 'partial_receive') {
                      txTypeIcon = '📥';
                      txTypeLabel = 'Partial Privacy Receive';
                      labelColor = 'bg-amber-900/50';
                    } else if (txType === 'public_send') {
                      txTypeIcon = '📤';
                      txTypeLabel = 'Public Send';
                      labelColor = 'bg-neutral-900';
                    } else if (txType === 'public_receive') {
                      txTypeIcon = '📥';
                      txTypeLabel = 'Public Receive';
                      labelColor = 'bg-green-900/50';
                    } else if (txType === 'consolidate') {
                      txTypeIcon = '🔄';
                      txTypeLabel = 'Consolidate';
                      labelColor = 'bg-blue-900/50';
                    } else if (txIsShielded || tx.memo?.includes('shield') || tx.memo?.includes('privacy') || tx.memo?.includes('🔒') || tx.memo?.includes('🛡️') || tx.memo?.includes('🔓') || tx.memo?.includes('🔐')) {
                      // Detect from memo content
                      if (tx.memo?.includes('Partial Privacy Receive') || tx.memo?.includes('📥')) {
                        txTypeIcon = '📥';
                        txTypeLabel = 'Partial Privacy Receive';
                        labelColor = 'bg-amber-900/50';
                      } else if (tx.memo?.includes('Private Receive') || tx.memo?.includes('🔐')) {
                        txTypeIcon = '🔐';
                        txTypeLabel = 'Private Receive';
                        labelColor = 'bg-purple-900/50';
                      } else if (tx.memo?.includes('Unshield') || tx.memo?.includes('🔓')) {
                        txTypeIcon = '🔓';
                        txTypeLabel = 'Unshield';
                        labelColor = 'bg-violet-900/50';
                      } else {
                        txTypeIcon = '🔒';
                        txTypeLabel = 'Shielded';
                        labelColor = 'bg-purple-900/50';
                      }
                    }
                    
                    // Get amount and token from transaction
                    const txAmount = (tx as any).amount;
                    const txToken = (tx as any).token;
                    const txFrom = (tx as any).from;
                    const txTo = (tx as any).to;

                    return (
                      <div 
                        key={tx.signature}
                        className="bg-black/30 rounded-xl p-4 hover:bg-black/40 transition-colors"
                      >
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-lg">{txTypeIcon}</span>
                              <span className={`text-xs font-semibold ${statusColor}`}>{status}</span>
                              <span className={`text-xs text-neutral-300 ${labelColor} px-2 py-1 rounded`}>{txTypeLabel}</span>
                            </div>
                            <p className="text-xs text-neutral-400 mt-1">{date}</p>
                          </div>
                          <div className="text-right">
                            {txAmount && (
                              <p className={`text-sm font-semibold ${txType?.includes('receive') ? 'text-green-400' : txType?.includes('send') || txType?.includes('withdraw') ? 'text-red-400' : 'text-neutral-200'}`}>
                                {txType?.includes('receive') ? '+' : txType?.includes('send') || txType?.includes('withdraw') ? '-' : ''}{txAmount} {txToken || 'NOC'}
                              </p>
                            )}
                            <span className="text-xs text-neutral-500">#{idx + 1}</span>
                          </div>
                        </div>
                        
                        {/* From/To addresses */}
                        {(txFrom || txTo) && (
                          <div className="text-xs text-neutral-400 mb-2 space-y-1">
                            {txFrom && <p>From: <span className="text-neutral-300">{txFrom}</span></p>}
                            {txTo && <p>To: <span className="text-neutral-300">{txTo}</span></p>}
                          </div>
                        )}
                        
                        <div className="flex items-center gap-2 mt-2">
                          <a
                            href={explorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                          >
                            {tx.signature.slice(0, 8)}...{tx.signature.slice(-8)}
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                              <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                            </svg>
                          </a>
                        </div>
                        
                        {tx.memo && (
                          <div className="text-xs text-neutral-500 mt-2 italic">
                            {tx.memo.slice(0, 80)}{tx.memo.length > 80 ? '...' : ''}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
              
              <div className="mt-4 pt-4 border-t border-neutral-700 text-xs text-neutral-400">
                <p>💡 Tip: Click transaction signature to view details on Solana Explorer</p>
                <p className="mt-2 flex flex-wrap gap-2">
                  <span>🔒 Private Send</span>
                  <span>🔐 Private Receive</span>
                  <span>📥 Partial Privacy</span>
                  <span>🛡️ Shield</span>
                  <span>🔓 Unshield</span>
                  <span>📤 Public</span>
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Shield Deposit Modal */}
        {showShieldModal && (
          <div 
            className="modal-overlay"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowShieldModal(false);
            }}
          >
            <div className="modal-content max-w-md">
              <div className="modal-header">
                <h3 className="modal-title">Shield Funds</h3>
                <button 
                  className="modal-close"
                  onClick={() => setShowShieldModal(false)}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                {/* Token Selector */}
                <div>
                  <label className="block text-sm text-neutral-400 mb-2">Token to Shield</label>
                  <div className="flex gap-2">
                    {(['SOL', 'NOC'] as const).map((token) => (
                      <button
                        key={token}
                        onClick={() => setShieldToken(token)}
                        className={`p-3 rounded-lg border transition-colors ${
                          shieldToken === token
                            ? 'border-[#8b5cf6] bg-[#8b5cf6]/10 text-[#8b5cf6]'
                            : 'border-white/10 text-neutral-400 hover:border-white/20'
                        }`}
                      >
                        {token}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Amount Input */}
                <div>
                  <label className="block text-sm text-neutral-400 mb-2">
                    Amount {shieldToken}
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      value={shieldAmount}
                      onChange={(e) => setShieldAmount(e.target.value)}
                      placeholder="0.00"
                      className="input-field"
                    />
                    <button
                      onClick={() => {
                        const max = shieldToken === 'SOL' ? solBalance : nocBalance;
                        setShieldAmount(max.toString());
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#8b5cf6] hover:text-[#a78bfa]"
                    >
                      Max
                    </button>
                  </div>
                  <p className="text-xs text-neutral-500 mt-1">
                    Available: {shieldToken === 'SOL' ? solBalance.toFixed(6) : nocBalance.toFixed(2)} {shieldToken}
                  </p>
                </div>

                {/* Privacy Fee Info */}
                <div className="bg-black/30 rounded-lg p-3 text-xs text-neutral-300 border border-white/10">
                  <div className="flex justify-between mb-2">
                    <span>Amount to Shield:</span>
                    <span>{shieldAmount || '0'} {shieldToken}</span>
                  </div>
                  <div className="flex justify-between mb-2">
                    <span>Privacy Fee:</span>
                    <span>0.25 NOC</span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>SOL Network Fee:</span>
                    <span className="text-green-400">0.000005 SOL</span>
                  </div>
                </div>

                {/* Info */}
                <div className="bg-black/30 rounded-lg p-3 text-xs text-neutral-400">
                  <p>Move your funds to the shielded vault to hide transaction amounts and addresses on the blockchain.</p>
                </div>

                {/* Action Button */}
                <button
                  onClick={() => {
                    if (onShieldDeposit && shieldAmount && shieldToken) {
                      onShieldDeposit(shieldToken, shieldAmount);
                      setShowShieldModal(false);
                      setShieldAmount('');
                    }
                  }}
                  disabled={!shieldAmount || isNaN(parseFloat(shieldAmount)) || parseFloat(shieldAmount) <= 0}
                  className="w-full btn-primary"
                  style={{
                    background: `linear-gradient(90deg, #8b5cf6 0%, #a78bfa 100%)`,
                    opacity: !shieldAmount || isNaN(parseFloat(shieldAmount)) ? 0.5 : 1,
                  }}
                >
                  Shield {shieldAmount} {shieldToken}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Privacy Settings Modal - Dynamic Import */}
        {showPrivacySettings && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur flex items-center justify-center px-4 z-50">
            <div className="bg-surface rounded-2xl max-w-2xl w-full p-6 space-y-4 max-h-96 overflow-y-auto">
              <div className="flex justify-between items-start">
                <h2 className="text-2xl font-semibold">Privacy Settings</h2>
                <button onClick={() => setShowPrivacySettings(false)} className="text-neutral-400 hover:text-white">
                  ✕
                </button>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm uppercase tracking-[0.2em] text-neutral-400">Active Privacy Features</h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-3 bg-black/30 rounded-lg">
                    <span className="text-sm font-semibold">Private Relayer Pool</span>
                    <span className="text-xs text-green-400">● Active</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-black/30 rounded-lg">
                    <span className="text-sm font-semibold">Fee Obfuscation</span>
                    <span className="text-xs text-green-400">● Active</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-black/30 rounded-lg">
                    <span className="text-sm font-semibold">Timing Privacy</span>
                    <span className="text-xs text-green-400">● Active</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-black/30 rounded-lg">
                    <span className="text-sm font-semibold">Account Anonymity</span>
                    <span className="text-xs text-green-400">● Active</span>
                  </div>
                </div>
              </div>

              <div className="bg-[#8b5cf6]/10 border border-[#8b5cf6]/20 rounded-lg p-3">
                <p className="text-xs text-neutral-300">
                  <strong>100% Privacy Achieved:</strong> Your shielded transactions are relayed through anonymous accounts, 
                  fees are pooled with others, submission timing is randomized, and account identity is rotated regularly.
                </p>
              </div>

              <button
                onClick={() => setShowPrivacySettings(false)}
                className="w-full px-4 py-2 bg-[#8b5cf6] text-white rounded-xl hover:bg-[#a78bfa] transition-colors text-sm font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* How To Use Modal */}
        <HowToUseModal open={howToUseOpen} onClose={() => setHowToUseOpen(false)} />
        
        {/* Mobile Bottom Navigation - only visible on mobile */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-[#0d1225]/95 backdrop-blur-md border-t border-white/10 z-50">
          <div className="flex justify-around items-center py-3 px-4">
            <button className="flex flex-col items-center gap-1 text-[#00f0ff]" title="Portfolio">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
                <path d="M16 4H8a2 2 0 0 0-2 2v2h12V6a2 2 0 0 0-2-2z"/>
              </svg>
              <span className="text-[10px]">Portfolio</span>
            </button>
            <button 
              className="flex flex-col items-center gap-1 text-[#00f0ff]" 
              title="Activity"
              onClick={async () => {
                if (onFetchTransactions) {
                  setShowActivityModal(true);
                  setLoadingTransactions(true);
                  try {
                    const txs = await onFetchTransactions();
                    setTransactions(txs);
                  } catch (err) {
                    console.error('Failed to fetch transactions:', err);
                  } finally {
                    setLoadingTransactions(false);
                  }
                }
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 12h18M3 6h18M3 18h18"/>
              </svg>
              <span className="text-[10px]">Activity</span>
            </button>
            <button 
              className="flex flex-col items-center gap-1 text-[#00f0ff]" 
              title="Settings"
              onClick={() => setShowPrivacySettings(true)}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
              <span className="text-[10px]">Settings</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default Dashboard;
