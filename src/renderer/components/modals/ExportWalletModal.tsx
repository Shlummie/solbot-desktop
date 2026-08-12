import { useState } from 'react';
import { useAppStore } from '../../state/appStore';
import { lamportsToSol } from '@shared/utils/sol';

type Props = {
  onClose: () => void;
};

export const ExportWalletModal = ({ onClose }: Props) => {
  const wallets = useAppStore((state) => state.wallets);
  const appendLog = useAppStore((state) => state.appendLog);
  const [selectedPubkey, setSelectedPubkey] = useState<string>(wallets[0]?.publicKey ?? '');
  const [destination, setDestination] = useState('');

  const pickDestination = async () => {
    try {
      const filePath = await window.solbot.invoke('wallet:export-dialog');
      if (typeof filePath === 'string') {
        setDestination(filePath);
      }
    } catch (error) {
      appendLog(`Export dialog failed: ${String(error)}`);
    }
  };

  const onSubmit = async () => {
    if (!selectedPubkey || !destination) {
      appendLog('Select a wallet and destination');
      return;
    }
    try {
      await window.solbot.invoke('wallet:export', {
        publicKey: selectedPubkey,
        destination,
      });
      appendLog(`Exported wallet ${selectedPubkey} to ${destination}`);
      onClose();
    } catch (error) {
      appendLog(`Export failed: ${String(error)}`);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>Export Wallet</h3>
        <label>
          Wallet
          <select value={selectedPubkey} onChange={(event) => setSelectedPubkey(event.target.value)}>
            {wallets.map((wallet) => (
              <option key={wallet.publicKey} value={wallet.publicKey}>
                {wallet.publicKey} ({wallet.role}) – {lamportsToSol(wallet.balanceLamports)} SOL
              </option>
            ))}
          </select>
        </label>
        <label>
          Destination File
          <div className="file-picker-row">
            <input value={destination} onChange={(event) => setDestination(event.target.value)} />
            <button onClick={pickDestination}>Browse…</button>
          </div>
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={onSubmit} disabled={!selectedPubkey || !destination}>
            Export
          </button>
        </div>
      </div>
    </div>
  );
};
