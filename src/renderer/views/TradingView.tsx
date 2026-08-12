import { useEffect, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { useAppStore } from '../state/appStore';
import type { AppConfig } from '@shared/config';

export const TradingView = () => {
  const config = useAppStore((state) => state.config);
  const setConfig = useAppStore((state) => state.setConfig);
  const pushToast = useAppStore((state) => state.pushToast);
  const appendLog = useAppStore((state) => state.appendLog);
  const setTradeHistory = useAppStore((state) => state.setTradeHistory);
  const tradeHistory = useAppStore((state) => state.tradeHistory);
  const [isTrading, setIsTrading] = useState(false);
  const [pumpMint, setPumpMint] = useState(() => localStorage.getItem('pumpMint') ?? '');
  const [pumpSolAmount, setPumpSolAmount] = useState(() => localStorage.getItem('pumpSolAmount') ?? '0.1');
  const [sellPercent, setSellPercent] = useState(() => localStorage.getItem('sellPercent') ?? '100');
  const explorerCluster = config.rpc.primary.includes('devnet')
    ? '?cluster=devnet'
    : config.rpc.primary.includes('testnet')
      ? '?cluster=testnet'
      : '';

  useEffect(() => {
    const loadHistory = async () => {
      try {
        const history = await window.solbot.invoke('trade:history');
        if (Array.isArray(history)) {
          setTradeHistory(history as typeof tradeHistory);
        }
      } catch (error) {
        appendLog(`Failed to load trade history: ${String(error)}`);
      }
    };

    void loadHistory();
  }, [appendLog, setTradeHistory]);

  const persistTradeConfig = async (updater: (prev: AppConfig) => AppConfig) => {
    const prev = useAppStore.getState().config;
    const next = updater(prev);
    setConfig(next);
    try {
      await window.solbot.invoke('config:save', next);
    } catch (error) {
      const message = `Trading config update failed: ${String(error)}`;
      appendLog(message);
      pushToast({ type: 'error', message: 'Failed to save trading settings' });
    }
  };

  const updateOrderSizing = (field: 'min' | 'max', value: string) => {
    void persistTradeConfig((prev) => ({
      ...prev,
      trade: {
        ...prev.trade,
        orderSizing: {
          ...prev.trade.orderSizing,
          [field]: Number(value),
        },
      },
    }));
  };

  const updateSlippage = (value: string) => {
    void persistTradeConfig((prev) => ({
      ...prev,
      trade: {
        ...prev.trade,
        slippageBpsDefault: Number(value),
      },
    }));
  };

  const updatePriorityFee = (value: string) => {
    void persistTradeConfig((prev) => ({
      ...prev,
      trade: {
        ...prev.trade,
        priorityFee: {
          ...prev.trade.priorityFee,
          maxMicroLamports: Number(value),
        },
      },
    }));
  };

  const executePumpBuy = async (side: 'buy' | 'sell') => {
    const trimmedMint = pumpMint.trim();
    if (!trimmedMint) {
      pushToast({ type: 'error', message: 'Enter a token contract address' });
      return;
    }

    try {
      new PublicKey(trimmedMint);
    } catch {
      pushToast({ type: 'error', message: 'Invalid contract address' });
      return;
    }

    setIsTrading(true);
    try {
      let payload: Record<string, unknown> = {
        tokenMint: trimmedMint,
        side,
      };

      if (side === 'buy') {
        const solAmount = Number(pumpSolAmount);
        if (!Number.isFinite(solAmount) || solAmount <= 0) {
          pushToast({ type: 'error', message: 'Enter a SOL amount greater than zero' });
          setIsTrading(false);
          return;
        }
        payload = { ...payload, customSol: solAmount };
      } else {
        const percent = Number(sellPercent);
        if (!Number.isFinite(percent) || percent <= 0) {
          pushToast({ type: 'error', message: 'Enter a sell percent greater than zero' });
          setIsTrading(false);
          return;
        }
        payload = { ...payload, sellPercent: percent };
      }

      const signatures = await window.solbot.invoke('wallet:trade', payload);
      pushToast({ type: 'success', message: `Pump.fun ${side} submitted` });
      appendLog(`Pump ${side} triggered for ${trimmedMint}: ${JSON.stringify(signatures)}`);
      const history = await window.solbot.invoke('trade:history');
      if (Array.isArray(history)) {
        setTradeHistory(history as typeof tradeHistory);
      }
    } catch (error) {
      pushToast({ type: 'error', message: `Pump ${side} failed` });
      appendLog(`Pump ${side} failed: ${String(error)}`);
    } finally {
      setIsTrading(false);
    }
  };

  return (
    <div className="view trading-view">
      <div className="view-header">
        <h2>Trading</h2>
      </div>
      <section>
        <div className="config-grid">
          <div>
            <label>Default Slippage (bps)</label>
            <input
              type="number"
              min={0}
              value={config.trade.slippageBpsDefault}
              onChange={(event) => updateSlippage(event.target.value)}
            />
          </div>
          <div>
            <label>Order Size Min (SOL)</label>
            <input
              type="number"
              step="0.0001"
              value={config.trade.orderSizing.min}
              onChange={(event) => updateOrderSizing('min', event.target.value)}
            />
          </div>
          <div>
            <label>Order Size Max (SOL)</label>
            <input
              type="number"
              step="0.0001"
              value={config.trade.orderSizing.max}
              onChange={(event) => updateOrderSizing('max', event.target.value)}
            />
          </div>
          <div>
            <label>Priority Fee Cap (μLamports)</label>
            <input
              type="number"
              min={0}
              value={config.trade.priorityFee.maxMicroLamports}
              onChange={(event) => updatePriorityFee(event.target.value)}
            />
          </div>
        </div>
      </section>
      <section>
        <h3>Pump.fun Quick Buy</h3>
        <div className="pump-buy-grid">
          <div>
            <label htmlFor="pump-mint">Contract Address (mint)</label>
            <input
              id="pump-mint"
              value={pumpMint}
              onChange={(event) => {
                setPumpMint(event.target.value);
                localStorage.setItem('pumpMint', event.target.value);
              }}
              placeholder="Enter pump.fun CA"
            />
          </div>
          <div>
            <label htmlFor="pump-sol">SOL per Wallet</label>
            <input
              id="pump-sol"
              type="number"
              min={0.0001}
              step={0.0001}
              value={pumpSolAmount}
              onChange={(event) => {
                setPumpSolAmount(event.target.value);
                localStorage.setItem('pumpSolAmount', event.target.value);
              }}
            />
          </div>
          <div>
            <label htmlFor="pump-sell-percent">Sell Percent</label>
            <input
              id="pump-sell-percent"
              type="number"
              min={1}
              max={100}
              step={1}
              value={sellPercent}
              onChange={(event) => {
                setSellPercent(event.target.value);
                localStorage.setItem('sellPercent', event.target.value);
              }}
            />
          </div>
          <div className="actions">
            <button type="button" disabled={isTrading} onClick={() => executePumpBuy('buy')}>
              {isTrading ? 'Submitting…' : 'Buy Pump Coin'}
            </button>
            <button type="button" disabled={isTrading} onClick={() => executePumpBuy('sell')}>
              {isTrading ? 'Submitting…' : 'Sell Pump Coin'}
            </button>
          </div>
        </div>
        <p className="hint">Uses current side-wallet list and Jupiter routing. Ensure liquidity before buying.</p>
      </section>
      <section>
        <h3>Trade History</h3>
        {tradeHistory.length === 0 && <div className="empty">No trades yet.</div>}
        {tradeHistory.length > 0 && (
          <table className="trade-history-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Wallet</th>
                <th>Mint</th>
                <th>Side</th>
                <th>Amount (SOL)</th>
                <th>Status</th>
                <th>Signature</th>
              </tr>
            </thead>
            <tbody>
              {tradeHistory.map((item) => (
                <tr key={`${item.wallet}-${item.timestamp}-${item.side}`}>
                  <td>{new Date(item.timestamp).toLocaleTimeString()}</td>
                  <td>{item.wallet}</td>
                  <td>{item.mint}</td>
                  <td>{item.side}</td>
                  <td>{(item.lamports / 1_000_000_000).toFixed(4)}</td>
                  <td>{item.error ? 'Error' : item.signature ? 'Success' : 'Skipped'}</td>
                  <td>
                    {item.signature ? (
                      <a
                        href={`https://explorer.solana.com/tx/${item.signature}${explorerCluster}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View
                      </a>
                    ) : (
                      item.error ?? '-'
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
