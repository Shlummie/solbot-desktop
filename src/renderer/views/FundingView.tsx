import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../state/appStore';
import type { FundingResult } from '@shared/types/funding';
import type { AppConfig } from '@shared/config';

export const FundingView = () => {
  const config = useAppStore((state) => state.config);
  const setConfig = useAppStore((state) => state.setConfig);
  const pushToast = useAppStore((state) => state.pushToast);
  const appendLog = useAppStore((state) => state.appendLog);
  const [isFunding, setIsFunding] = useState(false);
  const [results, setResults] = useState<FundingResult[]>([]);
  const setFundingHistory = useAppStore((state) => state.setFundingHistory);
  const fundingHistory = useAppStore((state) => state.fundingHistory);
  const explorerCluster = config.rpc.primary.includes('devnet')
    ? '?cluster=devnet'
    : config.rpc.primary.includes('testnet')
      ? '?cluster=testnet'
      : '';

  const persistConfig = useCallback(
    async (updater: (prev: AppConfig) => AppConfig) => {
      const prev = useAppStore.getState().config;
      const next = updater(prev);
      setConfig(next);
      try {
        await window.solbot.invoke('config:save', next);
      } catch (error) {
        const message = `Funding config update failed: ${String(error)}`;
        appendLog(message);
        pushToast({ type: 'error', message: 'Failed to save funding settings' });
      }
    },
    [setConfig, appendLog, pushToast],
  );

  const loadHistory = useCallback(async () => {
    try {
      const history = await window.solbot.invoke('funding:history');
      if (Array.isArray(history)) {
        const casted = history as FundingResult[];
        setResults(casted);
        setFundingHistory(casted);
      }
    } catch (error) {
      appendLog(`Failed to load funding history: ${String(error)}`);
    }
  }, [appendLog, setFundingHistory]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const updateFundingField = (field: 'minSol' | 'maxSol' | 'minRentBufferSol', value: string) => {
    void persistConfig((prev) => {
      const nextFunding = { ...prev.funding };
      if (field === 'minRentBufferSol') {
        nextFunding.minRentBufferSol = Number(value === '' ? prev.funding.minRentBufferSol : value);
      } else {
        nextFunding[field] = value === '' ? undefined : Number(value);
      }
      return {
        ...prev,
        funding: nextFunding,
      };
    });
  };

  return (
    <div className="view funding-view">
      <div className="view-header">
        <h2>Funding</h2>
        <button
          disabled={isFunding}
          onClick={async () => {
            setIsFunding(true);
            try {
              const response = await window.solbot.invoke('wallet:fund');
              if (Array.isArray(response)) {
                const casted = response as FundingResult[];
                setResults(casted);
                setFundingHistory(casted);
              }
              pushToast({ type: 'success', message: 'Funding completed' });
              appendLog(`Funding triggered: ${JSON.stringify(response)}`);
            } catch (error) {
              pushToast({ type: 'error', message: 'Funding failed' });
              appendLog(`Funding failed: ${String(error)}`);
            } finally {
              setIsFunding(false);
            }
          }}
        >
          {isFunding ? 'Funding…' : 'Fund'}
        </button>
      </div>
      <div className="grid">
        <div>
          <label>Min SOL per Wallet</label>
          <input
            type="number"
            step="0.0001"
            value={config.funding.minSol ?? ''}
            onChange={(event) => updateFundingField('minSol', event.target.value)}
          />
        </div>
        <div>
          <label>Max SOL per Wallet</label>
          <input
            type="number"
            step="0.0001"
            value={config.funding.maxSol ?? ''}
            onChange={(event) => updateFundingField('maxSol', event.target.value)}
          />
        </div>
        <div>
          <label>Rent Buffer (SOL)</label>
          <input
            type="number"
            step="0.0001"
            value={config.funding.minRentBufferSol}
            onChange={(event) => updateFundingField('minRentBufferSol', event.target.value)}
          />
        </div>
        <div>
          <label>Concurrency Limit</label>
          <div>{config.limits.maxConcurrent}</div>
        </div>
      </div>
      {results.length > 0 && (
        <div className="funding-results">
          <h3>Latest Funding Batch</h3>
          <ul>
            {results.map((item) => (
              <li key={`${item.wallet}-${item.timestamp}-${item.lamports}`}>
                <span>{item.wallet}</span>
                <span>{(item.lamports / 1_000_000_000).toFixed(4)} SOL</span>
                {item.signature && (
                  <a
                    href={`https://explorer.solana.com/tx/${item.signature}${explorerCluster}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View
                  </a>
                )}
                {item.error && <span className="error-text">{item.error}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <section className="funding-history">
        <h3>Funding History</h3>
        {fundingHistory.length === 0 && <div className="empty">No funding events yet.</div>}
        {fundingHistory.length > 0 && (
          <table className="funding-history-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Wallet</th>
                <th>Amount (SOL)</th>
                <th>Status</th>
                <th>Signature</th>
              </tr>
            </thead>
            <tbody>
              {fundingHistory.map((entry) => (
                <tr key={`${entry.wallet}-${entry.timestamp}`}>
                  <td>{new Date(entry.timestamp).toLocaleTimeString()}</td>
                  <td>{entry.wallet}</td>
                  <td>{(entry.lamports / 1_000_000_000).toFixed(4)}</td>
                  <td>{entry.error ? 'Failed' : entry.signature ? 'Success' : 'Pending'}</td>
                  <td>
                    {entry.signature ? (
                      <a href={`https://explorer.solana.com/tx/${entry.signature}${explorerCluster}`} target="_blank" rel="noreferrer">
                        View
                      </a>
                    ) : (
                      entry.error ?? '-'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
};
