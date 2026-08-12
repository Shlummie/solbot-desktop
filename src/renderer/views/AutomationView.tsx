import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '../state/appStore';
import type { AutomationConfig, AutomationStatus } from '@shared/types/automation';

const getSavedPumpMint = () => localStorage.getItem('pumpMint') ?? '';

export const AutomationView = () => {
  const wallets = useAppStore((state) => state.wallets);
  const automationConfig = useAppStore((state) => state.automationConfig);
  const automationStatus = useAppStore((state) => state.automationStatus);
  const setAutomationConfig = useAppStore((state) => state.setAutomationConfig);
  const setAutomationStatus = useAppStore((state) => state.setAutomationStatus);
  const pushToast = useAppStore((state) => state.pushToast);
  const appendLog = useAppStore((state) => state.appendLog);

  const [localConfig, setLocalConfig] = useState<AutomationConfig>(automationConfig);
  const [mint, setMint] = useState(getSavedPumpMint());

  const sideWallets = wallets.filter((w) => w.role === 'side');

  // Load config and status on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        const config = await window.solbot.invoke<AutomationConfig>('automation:get-config');
        setAutomationConfig(config);
        setLocalConfig(config);
        
        const status = await window.solbot.invoke<AutomationStatus>('automation:get-status');
        setAutomationStatus(status);
      } catch (error) {
        appendLog(`Failed to load automation config: ${String(error)}`);
      }
    };
    void loadData();
  }, [setAutomationConfig, setAutomationStatus, appendLog]);

  // Listen for status updates from main process
  useEffect(() => {
    // Note: preload's `on` wrapper already strips the IPC event,
    // so we receive status as the first argument directly
    const handler = (status: AutomationStatus) => {
      // Use requestAnimationFrame to batch status updates and prevent UI thrashing
      requestAnimationFrame(() => {
        try {
          if (status && typeof status.running === 'boolean') {
            setAutomationStatus(status);
          } else {
            console.warn('Received invalid automation status:', status);
          }
        } catch (error) {
          console.error('Failed to update automation status:', error);
        }
      });
    };
    window.solbot.on('automation:status', handler);
    return () => window.solbot.off('automation:status', handler);
  }, [setAutomationStatus]);

  // Sync mint from localStorage (check less frequently to reduce overhead)
  useEffect(() => {
    const checkMint = () => {
      const newMint = getSavedPumpMint();
      setMint((prev) => (prev !== newMint ? newMint : prev));
    };
    const interval = setInterval(checkMint, 2000);
    // Also check on visibility change
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkMint();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  const saveConfig = useCallback(async (config: AutomationConfig) => {
    try {
      await window.solbot.invoke('automation:save-config', config);
      setAutomationConfig(config);
      setLocalConfig(config);
    } catch (error) {
      pushToast({ type: 'error', message: 'Failed to save config' });
      appendLog(`Failed to save automation config: ${String(error)}`);
    }
  }, [setAutomationConfig, pushToast, appendLog]);

  const updateConfig = (updates: Partial<AutomationConfig>) => {
    const newConfig = { ...localConfig, ...updates };
    setLocalConfig(newConfig);
    void saveConfig(newConfig);
  };

  const toggleWallet = async (publicKey: string, enabled: boolean) => {
    try {
      await window.solbot.invoke('automation:toggle-wallet', { publicKey, enabled });
      const newEnabledWallets = enabled
        ? [...localConfig.enabledWallets, publicKey]
        : localConfig.enabledWallets.filter((pk) => pk !== publicKey);
      setLocalConfig((prev) => ({ ...prev, enabledWallets: newEnabledWallets }));
      setAutomationConfig({ ...localConfig, enabledWallets: newEnabledWallets });
    } catch (error) {
      pushToast({ type: 'error', message: 'Failed to toggle wallet' });
      appendLog(`Failed to toggle wallet: ${String(error)}`);
    }
  };

  const toggleAllWallets = async (enabled: boolean) => {
    try {
      await window.solbot.invoke('automation:set-all-wallets', { enabled });
      const newEnabledWallets = enabled ? sideWallets.map((w) => w.publicKey) : [];
      setLocalConfig((prev) => ({ ...prev, enabledWallets: newEnabledWallets }));
      setAutomationConfig({ ...localConfig, enabledWallets: newEnabledWallets });
    } catch (error) {
      pushToast({ type: 'error', message: 'Failed to toggle all wallets' });
      appendLog(`Failed to toggle all wallets: ${String(error)}`);
    }
  };

  const startAutomation = async () => {
    if (!mint) {
      pushToast({ type: 'error', message: 'Enter a token mint in the Trading tab first' });
      return;
    }
    if (localConfig.enabledWallets.length === 0) {
      pushToast({ type: 'error', message: 'Enable at least one wallet' });
      return;
    }
    try {
      const success = await window.solbot.invoke<boolean>('automation:start', { mint });
      if (success) {
        pushToast({ type: 'success', message: 'Automation started' });
        appendLog(`Automation started for ${mint}`);
      } else {
        pushToast({ type: 'error', message: 'Failed to start automation' });
      }
    } catch (error) {
      pushToast({ type: 'error', message: 'Failed to start automation' });
      appendLog(`Automation start failed: ${String(error)}`);
    }
  };

  const stopAutomation = async () => {
    try {
      await window.solbot.invoke('automation:stop');
      pushToast({ type: 'info', message: 'Automation stopped' });
      appendLog('Automation stopped');
    } catch (error) {
      pushToast({ type: 'error', message: 'Failed to stop automation' });
      appendLog(`Failed to stop automation: ${String(error)}`);
    }
  };

  const allEnabled = sideWallets.length > 0 && sideWallets.every((w) => localConfig.enabledWallets.includes(w.publicKey));

  return (
    <div className="view automation-view">
      <div className="view-header">
        <h2>Automation</h2>
        <div className="actions">
          {automationStatus.running ? (
            <button onClick={stopAutomation} className="stop-button">
              Stop Automation
            </button>
          ) : (
            <button onClick={startAutomation} disabled={!mint || localConfig.enabledWallets.length === 0}>
              Start Automation
            </button>
          )}
        </div>
      </div>

      {automationStatus.running && (
        <div className="automation-status">
          <div className="status-badge running">🟢 Running</div>
          <div className="status-stats">
            <span>Total: {automationStatus.totalTrades}</span>
            <span>Success: {automationStatus.successfulTrades}</span>
            <span>Failed: {automationStatus.failedTrades}</span>
            {automationStatus.lastTradeTime && (
              <span>Last: {automationStatus.lastTradeSide} @ {new Date(automationStatus.lastTradeTime).toLocaleTimeString()}</span>
            )}
          </div>
          <div className="status-config">
            <span>Buy: {localConfig.buySol.min.toFixed(3)}-{localConfig.buySol.max.toFixed(3)} SOL</span>
            <span>Sell: {localConfig.sellPercent.min}-{localConfig.sellPercent.max}%</span>
            <span>Interval: {Math.round(localConfig.intervalMs.min / 1000)}-{Math.round(localConfig.intervalMs.max / 1000)}s</span>
          </div>
        </div>
      )}

      <section>
        <h3>Token</h3>
        <p className="hint">
          Using mint from Trading tab: <code>{mint || '(none set)'}</code>
        </p>
      </section>

      <section>
        <h3>Timing</h3>
        <div className="config-grid">
          <div>
            <label>Min Interval (seconds)</label>
            <input
              type="number"
              min={1}
              value={Math.round(localConfig.intervalMs.min / 1000)}
              onChange={(e) => updateConfig({
                intervalMs: { ...localConfig.intervalMs, min: Number(e.target.value) * 1000 }
              })}
              disabled={automationStatus.running}
            />
          </div>
          <div>
            <label>Max Interval (seconds)</label>
            <input
              type="number"
              min={1}
              value={Math.round(localConfig.intervalMs.max / 1000)}
              onChange={(e) => updateConfig({
                intervalMs: { ...localConfig.intervalMs, max: Number(e.target.value) * 1000 }
              })}
              disabled={automationStatus.running}
            />
          </div>
        </div>
      </section>

      <section>
        <h3>Buy/Sell Ratio</h3>
        <div className="config-grid">
          <div>
            <label>Buy Percentage: {localConfig.buyPercentage}%</label>
            <input
              type="range"
              min={0}
              max={100}
              value={localConfig.buyPercentage}
              onChange={(e) => updateConfig({ buyPercentage: Number(e.target.value) })}
              disabled={automationStatus.running}
            />
            <p className="hint">{localConfig.buyPercentage}% buy, {100 - localConfig.buyPercentage}% sell</p>
          </div>
        </div>
      </section>

      <section>
        <h3>Buy Amount (SOL)</h3>
        <div className="config-grid">
          <div>
            <label>Min SOL</label>
            <input
              type="number"
              min={0.001}
              step={0.001}
              value={localConfig.buySol.min}
              onChange={(e) => updateConfig({
                buySol: { ...localConfig.buySol, min: Number(e.target.value) }
              })}
              disabled={automationStatus.running}
            />
          </div>
          <div>
            <label>Max SOL</label>
            <input
              type="number"
              min={0.001}
              step={0.001}
              value={localConfig.buySol.max}
              onChange={(e) => updateConfig({
                buySol: { ...localConfig.buySol, max: Number(e.target.value) }
              })}
              disabled={automationStatus.running}
            />
          </div>
        </div>
      </section>

      <section>
        <h3>Sell Percentage Range</h3>
        <div className="config-grid">
          <div>
            <label>Min Sell %</label>
            <input
              type="number"
              min={1}
              max={100}
              value={localConfig.sellPercent.min}
              onChange={(e) => updateConfig({
                sellPercent: { ...localConfig.sellPercent, min: Number(e.target.value) }
              })}
              disabled={automationStatus.running}
            />
          </div>
          <div>
            <label>Max Sell %</label>
            <input
              type="number"
              min={1}
              max={100}
              value={localConfig.sellPercent.max}
              onChange={(e) => updateConfig({
                sellPercent: { ...localConfig.sellPercent, max: Number(e.target.value) }
              })}
              disabled={automationStatus.running}
            />
          </div>
        </div>
        <p className="hint">Each sell will randomly sell between {localConfig.sellPercent.min}% and {localConfig.sellPercent.max}% of token holdings</p>
      </section>

      <section>
        <h3>Enabled Wallets ({localConfig.enabledWallets.length}/{sideWallets.length})</h3>
        <div className="wallet-toggle-actions">
          <button onClick={() => toggleAllWallets(true)} disabled={automationStatus.running || allEnabled}>
            Enable All
          </button>
          <button onClick={() => toggleAllWallets(false)} disabled={automationStatus.running || localConfig.enabledWallets.length === 0}>
            Disable All
          </button>
        </div>
        <div className="wallet-toggle-list">
          {sideWallets.length === 0 && <p className="empty">No side wallets found. Create wallets in the Wallets tab.</p>}
          {sideWallets.map((wallet) => (
            <label key={wallet.publicKey} className="wallet-toggle-item">
              <input
                type="checkbox"
                checked={localConfig.enabledWallets.includes(wallet.publicKey)}
                onChange={(e) => toggleWallet(wallet.publicKey, e.target.checked)}
                disabled={automationStatus.running}
              />
              <span className="wallet-key">{wallet.publicKey}</span>
              <span className="wallet-balance">
                {wallet.balanceLamports !== undefined
                  ? `${(wallet.balanceLamports / 1_000_000_000).toFixed(4)} SOL`
                  : '-'}
              </span>
            </label>
          ))}
        </div>
      </section>
    </div>
  );
};

