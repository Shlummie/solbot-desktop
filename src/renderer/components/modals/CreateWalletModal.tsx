import { useState } from 'react';
import { z } from 'zod';
import type { WalletRole } from '@shared/types/wallet';
import { useAppStore } from '../../state/appStore';

const schema = z.object({
  count: z.number().min(1).max(100),
  role: z.custom<WalletRole>(),
});

type Props = {
  onClose: () => void;
};

export const CreateWalletModal = ({ onClose }: Props) => {
  const [count, setCount] = useState(5);
  const selectedRole = useAppStore((state) => state.selectedRole);
  const setSelectedRole = useAppStore((state) => state.setSelectedRole);
  const setWallets = useAppStore((state) => state.setWallets);
  const appendLog = useAppStore((state) => state.appendLog);

  const onSubmit = async () => {
    const payload = schema.safeParse({ count, role: selectedRole });
    if (!payload.success) {
      appendLog(`Create wallets validation failed: ${payload.error.message}`);
      return;
    }
    try {
      await window.solbot.invoke('wallet:create', payload.data);
      const list = await window.solbot.invoke('wallet:list');
      if (Array.isArray(list)) {
        setWallets(list);
      }
      appendLog(`Created ${payload.data.count} ${payload.data.role} wallets`);
      onClose();
    } catch (error) {
      appendLog(`Create wallets failed: ${String(error)}`);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>Create Wallets</h3>
        <label>
          Count
          <input
            type="number"
            min={1}
            max={100}
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
          />
        </label>
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
            Create
          </button>
        </div>
      </div>
    </div>
  );
};

