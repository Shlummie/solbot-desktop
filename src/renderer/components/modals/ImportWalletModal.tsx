import { useState } from 'react';
import { z } from 'zod';
import type { WalletRole } from '@shared/types/wallet';
import { useAppStore } from '../../state/appStore';

const fileSchema = z.object({
  path: z.string().min(1),
  role: z.custom<WalletRole>(),
});

type Props = {
  onClose: () => void;
};

const normalizeSecret = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed) as number[];
    } catch {
      return trimmed;
    }
  }
  return trimmed;
};

export const ImportWalletModal = ({ onClose }: Props) => {
  const [path, setPath] = useState('');
  const [secret, setSecret] = useState('');
  const [mode, setMode] = useState<'file' | 'secret'>('file');
  const selectedRole = useAppStore((state) => state.selectedRole);
  const setSelectedRole = useAppStore((state) => state.setSelectedRole);
  const setWallets = useAppStore((state) => state.setWallets);
  const appendLog = useAppStore((state) => state.appendLog);

  const onSubmit = async () => {
    try {
      if (mode === 'file') {
        const payload = fileSchema.safeParse({ path, role: selectedRole });
        if (!payload.success) {
          appendLog(`Import validation failed: ${payload.error.message}`);
          return;
        }
        await window.solbot.invoke('wallet:import', payload.data);
        appendLog(`Imported wallet as ${payload.data.role}`);
      } else {
        const normalized = normalizeSecret(secret);
        if (typeof normalized === 'string' && normalized.length === 0) {
          appendLog('Secret import validation failed: empty secret');
          return;
        }
        await window.solbot.invoke('wallet:import-secret', {
          role: selectedRole,
          secret: normalized,
        });
        appendLog(`Imported wallet from secret as ${selectedRole}`);
      }
      const list = await window.solbot.invoke('wallet:list');
      if (Array.isArray(list)) {
        setWallets(list);
      }
      onClose();
    } catch (error) {
      appendLog(`Import wallet failed: ${String(error)}`);
    }
  };

  const pickFile = async () => {
    try {
      const filePath = await window.solbot.invoke('wallet:import-dialog');
      if (typeof filePath === 'string') {
        setPath(filePath);
      }
    } catch (error) {
      appendLog(`Import dialog failed: ${String(error)}`);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>Import Wallet</h3>
        <div className="toggle-row">
          <label>
            <input
              type="radio"
              name="import-mode"
              value="file"
              checked={mode === 'file'}
              onChange={() => setMode('file')}
            />
            From File
          </label>
          <label>
            <input
              type="radio"
              name="import-mode"
              value="secret"
              checked={mode === 'secret'}
              onChange={() => setMode('secret')}
            />
            From Private Key
          </label>
        </div>
        {mode === 'file' ? (
          <label>
            File Path
            <div className="file-picker-row">
              <input value={path} onChange={(event) => setPath(event.target.value)} />
              <button onClick={pickFile}>Browse…</button>
            </div>
          </label>
        ) : (
          <label>
            Private Key (JSON array or base58)
            <textarea
              value={secret}
              rows={4}
              placeholder="[12,34,...] or base58"
              onChange={(event) => setSecret(event.target.value)}
            />
          </label>
        )}
        <label>
          Role
          <select value={selectedRole} onChange={(event) => setSelectedRole(event.target.value as WalletRole)}>
            <option value="main">Main</option>
            <option value="side">Side</option>
          </select>
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={onSubmit}>
            Import
          </button>
        </div>
      </div>
    </div>
  );
};

