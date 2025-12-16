import Dashboard from './Dashboard';
import { useWallet } from '../hooks/useWallet';

interface AppLayoutProps {
  solBalance: number;
  nocBalance: number;
  shieldedSolBalance: number;
  shieldedNocBalance: number;
  onReceive: () => void;
  onSend: () => void;
  onShield: () => void;
}

export function AppLayout({
  solBalance,
  nocBalance,
  shieldedSolBalance,
  shieldedNocBalance,
  onReceive,
  onSend,
  onShield,
}: AppLayoutProps) {
  const keypair = useWallet((state) => state.keypair);
  const mode = useWallet((state) => state.mode);
  const setMode = useWallet((state) => state.setMode);

  if (!keypair) {
    return null;
  }

  return (
    <Dashboard
      mode={mode}
      solBalance={solBalance}
      nocBalance={nocBalance}
      shieldedSolBalance={shieldedSolBalance}
      shieldedNocBalance={shieldedNocBalance}
      walletAddress={keypair.publicKey.toBase58()}
      onModeChange={setMode}
      onReceive={onReceive}
      onSend={onSend}
      onShield={onShield}
    />
  );
}
