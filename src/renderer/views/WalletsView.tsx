import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../state/appStore';
import { lamportsToSol } from '@shared/utils/sol';
import { CreateWalletModal } from '../components/modals/CreateWalletModal';
import { ImportWalletModal } from '../components/modals/ImportWalletModal';
import { ExportWalletModal } from '../components/modals/ExportWalletModal';

const getSavedPumpMint = () => localStorage.getItem('pumpMint') ?? '';
const getSavedPumpSol = () => Number(localStorage.getItem('pumpSolAmount') ?? '0.1');
const getSavedSellPercent = () => Number(localStorage.getItem('sellPercent') ?? '100');

export const WalletsView = () => {
  const wallets = useAppStore((state) => state.wallets);
  const isLoading = useAppStore((state) => state.isLoadingWallets);
  const setWallets = useAppStore((state) => state.setWallets);
  const setLoading = useAppStore((state) => state.setLoadingWallets);
  const appendLog = useAppStore((state) => state.appendLog);
  const showCreateModal = useAppStore((state) => state.showCreateModal);
  const setShowCreateModal = useAppStore((state) => state.setShowCreateModal);
  const showImportModal = useAppStore((state) => state.showImportModal);
  const setShowImportModal = useAppStore((state) => state.setShowImportModal);
  const showExportModal = useAppStore((state) => state.showExportModal);
  const setShowExportModal = useAppStore((state) => state.setShowExportModal);
  const config = useAppStore((state) => state.config);
  const pushToast = useAppStore((state) => state.pushToast);
  const [tokenSweepSelection, setTokenSweepSelection] = useState<Record<string, boolean>>({});

  const exportWalletsCsv = () => {
    if (wallets.length === 0) {
      return;
    }
    const header = 'publicKey,role,balanceSol,tag';
    const rows = wallets.map((wallet) => {
      const balanceSol = wallet.balanceLamports ? wallet.balanceLamports / 1_000_000_000 : 0;
      const safe = (value: string | number | undefined) =>
        typeof value === 'string' ? `"${value.replace(/"/g, '""')}"` : value ?? '';
      return [wallet.publicKey, wallet.role, balanceSol.toFixed(6), wallet.tag ?? ''].map(safe).join(',');
    });
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `solbot-wallets-${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const refreshWallets = useCallback(async () => {
    setLoading(true);
    try {
      const list = await window.solbot.invoke('wallet:list');
      setWallets(Array.isArray(list) ? (list as typeof wallets) : []);
    } catch (error) {
      appendLog(`Failed to load wallets: ${String(error)}`);
      pushToast({ type: 'error', message: 'Failed to load wallets' });
    } finally {
      setLoading(false);
    }
  }, [appendLog, pushToast, setLoading, setWallets]);

  useEffect(() => {
    void refreshWallets();
  }, [refreshWallets]);

  const sortedWallets = useMemo(() => {
    return [...wallets].sort((a, b) => {
      if (a.role === 'main' && b.role !== 'main') return -1;
      if (b.role === 'main' && a.role !== 'main') return 1;
      return 0;
    });
  }, [wallets]);

  const availableTokens = useMemo(() => config.trade.tokens.map((token) => token.mint), [config.trade.tokens]);

  useEffect(() => {
    setTokenSweepSelection((prev) => {
      const next = { ...prev };
      availableTokens.forEach((mint) => {
        if (next[mint] === undefined) next[mint] = true;
      });
      return next;
    });
  }, [availableTokens]);


  return (
    <div className="view wallets-view">
      <div className="view-header">
        <h2>Wallets</h2>
        <div className="actions">
          <button onClick={() => setShowCreateModal(true)}>Create</button>
          <button onClick={() => setShowImportModal(true)}>Import</button>
          <button onClick={() => setShowExportModal(true)}>Export</button>
          <div className="sweep-options">
            <div className="token-checkboxes">
              {config.trade.tokens.map((token) => (
                <label key={token.mint}>
                  <input
                    type="checkbox"
                    checked={tokenSweepSelection[token.mint] ?? true}
                    onChange={(event) =>
                      setTokenSweepSelection((prev) => ({
                        ...prev,
                        [token.mint]: event.target.checked,
                      }))
                    }
                  />
                  {token.symbol ?? token.mint}
                </label>
              ))}
            </div>
          </div>
          <button
            onClick={async () => {
              try {
                const includeTokens = Object.entries(tokenSweepSelection)
                  .filter(([, selected]) => selected)
                  .map(([mint]) => mint);
                const payload = {
                  includeTokens,
                  includeSol: true,
                };
                const response = await window.solbot.invoke('wallet:sweep', payload);
                appendLog(`Sweep initiated: ${JSON.stringify(response)}`);
                pushToast({ type: 'success', message: 'Sweep complete' });
                await refreshWallets();
              } catch (error) {
                appendLog(`Sweep failed: ${String(error)}`);
                pushToast({ type: 'error', message: 'Sweep failed' });
              }
            }}
          >
            Sweep
          </button>
          <button onClick={exportWalletsCsv} disabled={wallets.length === 0}>
            Export CSV
          </button>
          <button
            onClick={async () => {
              try {
                const destination = await window.solbot.invoke<string | null>('wallet:export-all-dialog');
                if (!destination) {
                  return;
                }
                const count = await window.solbot.invoke<number>('wallet:export-all', { destination });
                appendLog(`Exported ${count} side wallet private keys to ${destination}`);
                pushToast({ type: 'success', message: `Exported ${count} wallet keys` });
              } catch (error) {
                appendLog(`Export all failed: ${String(error)}`);
                pushToast({ type: 'error', message: 'Export failed' });
              }
            }}
            disabled={wallets.filter((w) => w.role === 'side').length === 0}
          >
            Export All Keys
          </button>
          <button
            onClick={async () => {
              try {
                const filePath = await window.solbot.invoke<string | null>('wallet:import-dialog');
                if (!filePath) {
                  return;
                }
                const result = await window.solbot.invoke<{ imported: number; skipped: number }>(
                  'wallet:import-bulk',
                  { path: filePath, role: 'side' }
                );
                appendLog(`Bulk import: ${result.imported} imported, ${result.skipped} skipped`);
                pushToast({ type: 'success', message: `Imported ${result.imported} wallets` });
                await refreshWallets();
              } catch (error) {
                appendLog(`Bulk import failed: ${String(error)}`);
                pushToast({ type: 'error', message: 'Bulk import failed' });
              }
            }}
          >
            Bulk Import
          </button>
        </div>
      </div>
      {isLoading && <div className="loading">Loading wallets…</div>}
      <table className="wallet-table">
        <thead>
          <tr>
            <th>Public Key</th>
            <th>Role</th>
            <th>Balance (SOL)</th>
            <th>Tag</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {sortedWallets.map((wallet) => (
            <tr key={wallet.publicKey}>
              <td>{wallet.publicKey}</td>
              <td className={wallet.role}>
                <div className="wallet-role-actions">
                  <select
                    value={wallet.role}
                    onChange={async (event) => {
                      const role = event.target.value as typeof wallet.role;
                      try {
                        await window.solbot.invoke('wallet:tag', {
                          publicKey: wallet.publicKey,
                          role,
                        });
                        await refreshWallets();
                        appendLog(`Updated role for ${wallet.publicKey} to ${role}`);
                        pushToast({ type: 'success', message: `Role set to ${role}` });
                      } catch (error) {
                        appendLog(`Failed to update role: ${String(error)}`);
                        pushToast({ type: 'error', message: 'Role update failed' });
                      }
                    }}
                  >
                    <option value="main">main</option>
                    <option value="side">side</option>
                  </select>
                  {wallet.role === 'side' && (
                    <div className="wallet-side-actions">
                      <button
                        className="link"
                        onClick={async () => {
                          const mint = getSavedPumpMint();
                          if (!mint) {
                            pushToast({ type: 'error', message: 'Set a pump.fun mint in Trading view first.' });
                            return;
                          }
                          const solAmount = getSavedPumpSol();
                          if (solAmount <= 0) {
                            pushToast({ type: 'error', message: 'Set a positive SOL amount in Trading view.' });
                            return;
                          }
                          try {
                            await window.solbot.invoke('wallet:trade', {
                              tokenMint: mint,
                              side: 'buy',
                              targetKeys: [wallet.publicKey],
                              customSol: solAmount,
                            });
                            pushToast({ type: 'success', message: `Quick buy queued for ${wallet.publicKey}` });
                          } catch (error) {
                            appendLog(`Quick buy failed for ${wallet.publicKey}: ${String(error)}`);
                            pushToast({ type: 'error', message: 'Quick buy failed' });
                          }
                        }}
                      >
                        Quick Buy
                      </button>
                      <button
                        className="link"
                        onClick={async () => {
                          const mint = getSavedPumpMint();
                          if (!mint) {
                            pushToast({ type: 'error', message: 'Set a pump.fun mint in Trading view first.' });
                            return;
                          }
                          const percent = getSavedSellPercent();
                          if (percent <= 0) {
                            pushToast({ type: 'error', message: 'Set a sell percent in Trading view.' });
                            return;
                          }
                          try {
                            await window.solbot.invoke('wallet:trade', {
                              tokenMint: mint,
                              side: 'sell',
                              targetKeys: [wallet.publicKey],
                              sellPercent: percent,
                            });
                            pushToast({ type: 'success', message: `Quick sell queued for ${wallet.publicKey}` });
                          } catch (error) {
                            appendLog(`Quick sell failed for ${wallet.publicKey}: ${String(error)}`);
                            pushToast({ type: 'error', message: 'Quick sell failed' });
                          }
                        }}
                      >
                        Quick Sell
                      </button>
                      <button
                        className="link"
                        onClick={async () => {
                          try {
                            await window.solbot.invoke('wallet:fund', {
                              targetKeys: [wallet.publicKey],
                            });
                            pushToast({ type: 'success', message: `Funding queued for ${wallet.publicKey}` });
                            await refreshWallets();
                          } catch (error) {
                            appendLog(`Quick fund failed for ${wallet.publicKey}: ${String(error)}`);
                            pushToast({ type: 'error', message: 'Quick fund failed' });
                          }
                        }}
                      >
                        Quick Fund
                      </button>
                    </div>
                  )}
                </div>
              </td>
              <td>{lamportsToSol(wallet.balanceLamports)}</td>
              <td>{wallet.tag ?? '-'}</td>
              <td>
                <button
                  className="link"
                  onClick={async () => {
                    if (!window.confirm('Remove this wallet?')) {
                      return;
                    }
                    try {
                      await window.solbot.invoke('wallet:remove', { publicKey: wallet.publicKey });
                      await refreshWallets();
                      appendLog(`Removed wallet ${wallet.publicKey}`);
                      pushToast({ type: 'info', message: 'Wallet removed' });
                    } catch (error) {
                      appendLog(`Failed to remove wallet: ${String(error)}`);
                      pushToast({ type: 'error', message: 'Failed to remove wallet' });
                    }
                  }}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {showCreateModal && <CreateWalletModal onClose={() => setShowCreateModal(false)} />}
      {showImportModal && <ImportWalletModal onClose={() => setShowImportModal(false)} />}
      {showExportModal && <ExportWalletModal onClose={() => setShowExportModal(false)} />}
    </div>
  );
};
