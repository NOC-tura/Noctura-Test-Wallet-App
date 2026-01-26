import React, { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useWallet } from '../hooks/useWallet';
import type { WalletAccount } from '../types/wallet';

interface WalletBalance {
  transparentSol: number;
  transparentNoc: number;
  shieldedSol: number;
  shieldedNoc: number;
}

interface WalletSelectorProps {
  /** Theme color for styling (cyan for transparent, purple for shielded) */
  themeColor?: string;
  /** Optional callback when wallet is switched */
  onWalletSwitch?: (account: WalletAccount) => void;
  /** Balances for each wallet address */
  balances?: Record<string, WalletBalance>;
  /** Current mode - 'transparent' or 'shielded' */
  mode?: 'transparent' | 'shielded';
}

export function WalletSelector({ 
  themeColor = '#00f0ff', 
  onWalletSwitch,
  balances = {},
  mode = 'transparent',
}: WalletSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isAddingWallet, setIsAddingWallet] = useState(false);
  const [newWalletName, setNewWalletName] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  const isShielded = mode === 'shielded';
  
  const accounts = useWallet((state) => state.accounts);
  const activeAccountIndex = useWallet((state) => state.activeAccountIndex);
  const stored = useWallet((state) => state.stored);
  const addWallet = useWallet((state) => state.addWallet);
  const switchWallet = useWallet((state) => state.switchWallet);
  const renameWallet = useWallet((state) => state.renameWallet);
  const removeWallet = useWallet((state) => state.removeWallet);
  
  const activeAccount = accounts[activeAccountIndex];
  const hasMnemonic = !!stored?.mnemonic;
  
  // Update dropdown position when opening
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + 8,
        left: rect.left,
      });
    }
  }, [isOpen]);
  
  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        dropdownRef.current && !dropdownRef.current.contains(target) &&
        buttonRef.current && !buttonRef.current.contains(target)
      ) {
        setIsOpen(false);
        setIsAddingWallet(false);
        setEditingIndex(null);
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  const handleSwitchWallet = useCallback((index: number) => {
    switchWallet(index);
    setIsOpen(false);
    if (onWalletSwitch && accounts[index]) {
      onWalletSwitch(accounts[index]);
    }
  }, [switchWallet, onWalletSwitch, accounts]);
  
  const handleAddWallet = useCallback(() => {
    const name = newWalletName.trim() || undefined;
    const newAccount = addWallet(name);
    if (newAccount) {
      setNewWalletName('');
      setIsAddingWallet(false);
    }
  }, [addWallet, newWalletName]);
  
  const handleStartRename = useCallback((index: number, currentName: string) => {
    setEditingIndex(index);
    setEditName(currentName);
  }, []);
  
  const handleSaveRename = useCallback(() => {
    if (editingIndex !== null && editName.trim()) {
      renameWallet(editingIndex, editName.trim());
    }
    setEditingIndex(null);
    setEditName('');
  }, [editingIndex, editName, renameWallet]);
  
  const handleRemoveWallet = useCallback((index: number) => {
    if (confirm('Are you sure you want to remove this wallet? This cannot be undone.')) {
      removeWallet(index);
    }
  }, [removeWallet]);
  
  const handleCopyAddress = useCallback((address: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(address);
    setCopiedAddress(address);
    setTimeout(() => setCopiedAddress(null), 2000);
  }, []);
  
  // Calculate total balance across all wallets (based on mode)
  const totalBalance = Object.values(balances).reduce((acc, b) => {
    if (isShielded) {
      // In shielded mode, show only shielded balances
      return acc + (b.shieldedSol * 129.74) + (b.shieldedNoc * 0.5);
    } else {
      // In transparent mode, show only transparent balances
      return acc + (b.transparentSol * 129.74) + (b.transparentNoc * 0.5);
    }
  }, 0);
  
  const truncateAddress = (address: string) => {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };
  
  const getInitials = (name: string, index: number) => {
    if (index === 0) return 'MW';
    if (name.startsWith('Wallet ')) return `W${name.replace('Wallet ', '')}`;
    return name.slice(0, 2).toUpperCase();
  };
  
  if (!activeAccount) return null;
  
  // Dropdown content rendered via portal to escape overflow:hidden
  const dropdownContent = isOpen ? createPortal(
    <div 
      ref={dropdownRef}
      className="fixed w-[calc(100vw-16px)] md:w-80 max-w-80 rounded-xl bg-[#0d1225] border border-white/10 shadow-2xl overflow-hidden"
      style={{ 
        top: dropdownPosition.top,
        left: window.innerWidth < 768 ? 8 : dropdownPosition.left,
        right: window.innerWidth < 768 ? 8 : 'auto',
        zIndex: 99999,
        boxShadow: `0 8px 32px rgba(0,0,0,0.6), 0 0 20px ${themeColor}10`
      }}
    >
      {/* Header */}
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">My wallets</h3>
          <button 
            onClick={() => setIsOpen(false)}
            className="p-1 hover:bg-white/10 rounded-lg transition"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        
        {/* Total Net Worth */}
        <div className="mt-3">
          <div className="text-xs text-gray-400 uppercase tracking-wider">Net Worth</div>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold text-white">
              ${totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>
        
        {/* Recovery Phrase Indicator */}
        {hasMnemonic && (
          <div className="mt-2 text-xs text-gray-400 uppercase tracking-wider flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
            Recovery Phrase
          </div>
        )}
      </div>
      
      {/* Wallet List */}
      <div className="max-h-64 overflow-y-auto">
        {accounts.map((account, index) => {
          const balance = balances[account.publicAddress];
          // Calculate USD based on current mode
          const accountUsd = balance 
            ? isShielded
              ? (balance.shieldedSol * 129.74) + (balance.shieldedNoc * 0.5)
              : (balance.transparentSol * 129.74) + (balance.transparentNoc * 0.5)
            : 0;
          const isActive = index === activeAccountIndex;
          const isEditing = editingIndex === index;
          
          return (
            <div
              key={account.publicAddress}
              className={`p-3 flex items-center gap-3 hover:bg-white/5 cursor-pointer transition-all ${
                isActive ? 'bg-white/10' : ''
              }`}
              onClick={() => !isEditing && handleSwitchWallet(index)}
            >
              {/* Avatar */}
              <div 
                className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                style={{ 
                  backgroundColor: isActive ? `${themeColor}30` : '#2a2f4a',
                  color: isActive ? themeColor : '#888',
                }}
              >
                {getInitials(account.name, index)}
              </div>
              
              {/* Wallet Info */}
              <div className="flex-1 min-w-0">
                {isEditing ? (
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={handleSaveRename}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveRename()}
                    className="w-full bg-[#1a1f3a] text-white text-sm px-2 py-1 rounded border border-white/20 focus:outline-none focus:border-[#00f0ff]"
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <>
                    <div className="text-sm font-medium text-white truncate">{account.name}</div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-gray-400 font-mono">
                        {truncateAddress(account.publicAddress)}
                      </span>
                      <button
                        onClick={(e) => handleCopyAddress(account.publicAddress, e)}
                        className="p-0.5 hover:bg-white/10 rounded transition"
                        title="Copy address"
                      >
                        {copiedAddress === account.publicAddress ? (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2">
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                        ) : (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                          </svg>
                        )}
                      </button>
                    </div>
                  </>
                )}
              </div>
              
              {/* Balance */}
              <div className="text-right flex-shrink-0 min-w-[60px]">
                <div className="text-sm font-medium text-white">
                  ${accountUsd.toFixed(2)}
                </div>
              </div>
              
              {/* Actions */}
              {!isEditing && (
                <div className="flex gap-0.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStartRename(index, account.name);
                    }}
                    className="p-1.5 hover:bg-white/10 rounded-lg transition"
                    title="Rename"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                  </button>
                  {index !== 0 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveWallet(index);
                      }}
                      className="p-1.5 hover:bg-red-500/20 rounded-lg transition"
                      title="Remove"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                      </svg>
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      
      {/* Add Wallet Section */}
      <div className="border-t border-white/10 p-3">
        {isAddingWallet ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={newWalletName}
              onChange={(e) => setNewWalletName(e.target.value)}
              placeholder={`Wallet ${accounts.length}`}
              className="flex-1 bg-[#1a1f3a] text-white text-sm px-3 py-2 rounded-lg border border-white/20 focus:outline-none focus:border-[#00f0ff]"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleAddWallet()}
            />
            <button
              onClick={handleAddWallet}
              className="px-4 py-2 rounded-lg text-sm font-medium transition"
              style={{ backgroundColor: `${themeColor}20`, color: themeColor }}
            >
              Add
            </button>
            <button
              onClick={() => {
                setIsAddingWallet(false);
                setNewWalletName('');
              }}
              className="px-3 py-2 rounded-lg text-sm font-medium text-gray-400 hover:bg-white/10 transition"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setIsAddingWallet(true)}
            disabled={!hasMnemonic}
            className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition ${
              hasMnemonic 
                ? 'hover:bg-white/10 text-white' 
                : 'opacity-50 cursor-not-allowed text-gray-500'
            }`}
            title={!hasMnemonic ? 'Cannot add wallets when imported via private key' : 'Add a new wallet'}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={hasMnemonic ? themeColor : '#666'} strokeWidth="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="16"></line>
              <line x1="8" y1="12" x2="16" y2="12"></line>
            </svg>
            Add Wallet
          </button>
        )}
        
        {!hasMnemonic && (
          <p className="text-xs text-gray-500 text-center mt-2">
            Import with recovery phrase to add more wallets
          </p>
        )}
      </div>
    </div>,
    document.body
  ) : null;
  
  return (
    <div className="relative">
      {/* Trigger Button */}
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#1a1f3a]/60 backdrop-blur-md border border-white/10 hover:border-white/20 transition-all"
        style={{ borderColor: isOpen ? `${themeColor}40` : undefined }}
      >
        {/* Active wallet avatar */}
        <div 
          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
          style={{ 
            backgroundColor: `${themeColor}20`,
            color: themeColor,
          }}
        >
          {getInitials(activeAccount.name, activeAccountIndex)}
        </div>
        
        {/* Wallet info */}
        <div className="flex flex-col items-start">
          <span className="text-sm font-medium text-white">{activeAccount.name}</span>
          <span className="text-xs text-gray-400 font-mono">
            {truncateAddress(activeAccount.publicAddress)}
          </span>
        </div>
        
        {/* Dropdown arrow */}
        <svg 
          width="16" 
          height="16" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke={themeColor} 
          strokeWidth="2"
          className={`ml-1 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>
      
      {/* Dropdown rendered via portal */}
      {dropdownContent}
    </div>
  );
}

export default WalletSelector;
