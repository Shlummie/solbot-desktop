import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useAppStore } from '../state/appStore';
import type { RpcHealthSnapshot } from '@shared/types/scheduler';
import type { AppConfig } from '@shared/config';

const fetchRpcHealth = async () => {
  try {
    return (await window.solbot.invoke('rpc:health')) as RpcHealthSnapshot;
  } catch (error) {
    console.error(error);
    return undefined;
  }
};

export const SettingsView = () => {
  const config = useAppStore((state) => state.config);
  const setConfig = useAppStore((state) => state.setConfig);
  const pushToast = useAppStore((state) => state.pushToast);
  const appendLog = useAppStore((state) => state.appendLog);
  const setRpcHealth = useAppStore((state) => state.setRpcHealth);
  const pushRpcHealthHistory = useAppStore((state) => state.pushRpcHealthHistory);
  const clearRpcHealthHistory = useAppStore((state) => state.clearRpcHealthHistory);
  const rpcHealthHistory = useAppStore((state) => state.rpcHealthHistory);
  const [rpcHealthSnapshot, setRpcHealthSnapshot] = useState<RpcHealthSnapshot>();
  
  // Local state for inputs to avoid race conditions
  const [localPrimary, setLocalPrimary] = useState(config.rpc.primary);
  const [localFallbacks, setLocalFallbacks] = useState(config.rpc.fallbacks.join('\n'));
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingConfigRef = useRef<AppConfig | null>(null);

  // Sync local state when config changes from outside
  useEffect(() => {
    setLocalPrimary(config.rpc.primary);
    setLocalFallbacks(config.rpc.fallbacks.join('\n'));
  }, [config.rpc.primary, config.rpc.fallbacks]);

  // Debounced save function
  const debouncedSave = useCallback((newConfig: AppConfig) => {
    pendingConfigRef.current = newConfig;
    
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    saveTimeoutRef.current = setTimeout(async () => {
      const configToSave = pendingConfigRef.current;
      if (!configToSave) return;
      
      try {
        await window.solbot.invoke('config:save', configToSave);
        setConfig(configToSave);
      } catch (error) {
        appendLog(`Settings update failed: ${String(error)}`);
        pushToast({ type: 'error', message: 'Failed to save settings' });
      }
      pendingConfigRef.current = null;
    }, 500); // 500ms debounce
  }, [setConfig, appendLog, pushToast]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const updatePrimary = (value: string) => {
    setLocalPrimary(value);
    const newConfig = {
      ...config,
      rpc: { ...config.rpc, primary: value },
    };
    debouncedSave(newConfig);
  };

  const updateFallbacks = (value: string) => {
    setLocalFallbacks(value);
    const fallbacksArray = value
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const newConfig = {
      ...config,
      rpc: { ...config.rpc, fallbacks: fallbacksArray },
    };
    debouncedSave(newConfig);
  };

  const updateExecutionMode = (value: AppConfig['executionMode']) => {
    const newConfig = { ...config, executionMode: value };
    setConfig(newConfig);
    debouncedSave(newConfig);
  };

  useEffect(() => {
    void (async () => {
      const health = await fetchRpcHealth();
      setRpcHealthSnapshot(health);
      setRpcHealth(health ?? null);
      if (health) {
        pushRpcHealthHistory(health);
      }
    })();
  }, [pushRpcHealthHistory, setRpcHealth]);

  const sparklinePoints = useMemo(() => {
    if (rpcHealthHistory.length === 0) return '';
    const values = rpcHealthHistory
      .map((snapshot) =>
        snapshot.endpoints.reduce((sum, endpoint) => sum + endpoint.averageLatencyMs, 0) /
        (snapshot.endpoints.length || 1),
      )
      .slice(0, 20)
      .reverse();
    const max = Math.max(...values, 1);
    const step = 100 / (values.length - 1 || 1);
    return values
      .map((value, index) => `${index * step},${100 - (value / max) * 100}`)
      .join(' ');
  }, [rpcHealthHistory]);

  return (
    <div className="view settings-view">
      <div className="view-header">
        <h2>Settings</h2>
      </div>
      <section>
        <h3>Execution safety</h3>
        <div className="config-grid">
          <div>
            <label htmlFor="execution-mode">Execution mode</label>
            <select
              id="execution-mode"
              value={config.executionMode}
              onChange={(event) => updateExecutionMode(event.target.value as AppConfig['executionMode'])}
            >
              <option value="dry-run">Dry run (blocks on-chain writes)</option>
              <option value="live">Live (submits signed transactions)</option>
            </select>
          </div>
          <p>
            Public builds start in dry-run mode. Live mode can transfer funds and tokens and can lose money.
            Review every configured wallet, mint, RPC endpoint, amount, and fee before enabling it.
          </p>
        </div>
      </section>
      <section>
        <h3>RPC Endpoints</h3>
        <div className="config-grid">
          <div>
            <label>Primary</label>
            <input
              value={localPrimary}
              onChange={(event) => updatePrimary(event.target.value)}
              placeholder="https://api.devnet.solana.com"
            />
          </div>
          <div>
            <label>Fallbacks (one per line)</label>
            <textarea
              value={localFallbacks}
              onChange={(event) => updateFallbacks(event.target.value)}
              placeholder="https://rpc.example.invalid"
            />
          </div>
        </div>
        <div className="rpc-health">
          <div className="rpc-health-header">
            <h4>RPC Health</h4>
            <button
              onClick={async () => {
                const snapshot = await fetchRpcHealth();
                setRpcHealthSnapshot(snapshot);
                setRpcHealth(snapshot ?? null);
                if (snapshot) {
                  pushRpcHealthHistory(snapshot);
                }
              }}
            >
              Refresh
            </button>
          </div>
          {!rpcHealthSnapshot && <div className="empty">No data yet.</div>}
          {rpcHealthSnapshot && (
            <table>
              <thead>
                <tr>
                  <th>Endpoint</th>
                  <th>Failures</th>
                  <th>Avg Latency (ms)</th>
                  <th>Last Latency (ms)</th>
                  <th>Total Requests</th>
                  <th>Throttled</th>
                  <th>Rate Limit Backoffs</th>
                  <th>In-flight</th>
                  <th>Recent QPS</th>
                  <th>QPS Limit</th>
                </tr>
              </thead>
              <tbody>
                {rpcHealthSnapshot.endpoints.map((endpoint) => (
                  <tr key={endpoint.url}>
                    <td>{endpoint.url}</td>
                    <td>{endpoint.failureCount}</td>
                    <td>{endpoint.averageLatencyMs}</td>
                    <td>{endpoint.lastLatencyMs ?? '-'}</td>
                    <td>{endpoint.totalRequests}</td>
                    <td>{endpoint.throttled}</td>
                    <td>{endpoint.rateLimitBackoffs}</td>
                    <td>{endpoint.inFlight}</td>
                    <td>{endpoint.recentQps}</td>
                    <td>{endpoint.qpsLimit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="rpc-history">
            <div className="rpc-history-header">
              <h4>Snapshot History</h4>
              <button onClick={clearRpcHealthHistory} disabled={rpcHealthHistory.length === 0}>
                Clear History
              </button>
            </div>
            {rpcHealthHistory.length > 0 && sparklinePoints && (
              <svg viewBox="0 0 100 100" className="rpc-sparkline">
                <polyline points={sparklinePoints} />
              </svg>
            )}
            {rpcHealthHistory.length === 0 && <div className="empty">No snapshots recorded.</div>}
            {rpcHealthHistory.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>Collected</th>
                    <th>Endpoints</th>
                    <th>Avg Latency (ms)</th>
                    <th>Failures</th>
                    <th>Throttled</th>
                    <th>Rate Limit Backoffs</th>
                  </tr>
                </thead>
                <tbody>
                  {rpcHealthHistory.map((snapshot) => {
                    const aggregate = snapshot.endpoints.reduce(
                      (acc, endpoint) => {
                        acc.failures += endpoint.failureCount;
                        acc.avgLatency += endpoint.averageLatencyMs;
                        acc.throttled += endpoint.throttled;
                        acc.backoffs += endpoint.rateLimitBackoffs;
                        return acc;
                      },
                      { failures: 0, avgLatency: 0, throttled: 0, backoffs: 0 },
                    );
                    const avgLatency = Math.round(aggregate.avgLatency / (snapshot.endpoints.length || 1));
                    return (
                      <tr key={snapshot.collectedAt}>
                        <td>{new Date(snapshot.collectedAt).toLocaleTimeString()}</td>
                        <td>{snapshot.endpoints.length}</td>
                        <td>{avgLatency}</td>
                        <td>{aggregate.failures}</td>
                        <td>{aggregate.throttled}</td>
                        <td>{aggregate.backoffs}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
