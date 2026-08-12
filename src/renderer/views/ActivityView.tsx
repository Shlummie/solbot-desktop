import { useEffect, useState } from 'react';
import { useAppStore } from '../state/appStore';

export const ActivityView = () => {
  const logs = useAppStore((state) => state.activityLog);
  const clearLogs = useAppStore((state) => state.clearLogs);
  const appendLog = useAppStore((state) => state.appendLog);
  const [filter, setFilter] = useState('');

  const exportCsv = () => {
    if (logs.length === 0) {
      return;
    }
    const rows = logs.map((entry) => {
      const match = entry.match(/\[(.*?)] (.*)/);
      const timestamp = match ? match[1] : new Date().toISOString();
      const message = (match ? match[2] : entry) ?? '';
      return {
        timestamp: timestamp,
        message: message.replace(/"/g, '""'),
      };
    });
    const header = 'timestamp,message';
    const body = rows.map((row) => `"${row.timestamp}","${row.message}"`).join('\n');
    const csv = `${header}\n${body}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `solbot-activity-${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ level: string; msg: string }>;
      appendLog(`log:${custom.detail.level} ${custom.detail.msg}`);
    };
    window.addEventListener('solbot-log', handler);
    return () => window.removeEventListener('solbot-log', handler);
  }, [appendLog]);

  const filteredLogs = filter
    ? logs.filter((entry) => entry.toLowerCase().includes(filter.toLowerCase()))
    : logs;

  return (
    <div className="view activity-view">
      <div className="view-header">
        <h2>Activity</h2>
        <div className="actions">
          <input
            type="search"
            placeholder="Filter logs…"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <button onClick={exportCsv} disabled={logs.length === 0}>
            Export CSV
          </button>
          <button onClick={clearLogs}>Clear</button>
        </div>
      </div>
      <div className="log-panel">
        {filteredLogs.length === 0 && <div className="empty">No activity yet.</div>}
        {filteredLogs.map((entry, index) => {
          const isError = entry.toLowerCase().includes('fail');
          const isSuccess = entry.toLowerCase().includes('success') || entry.toLowerCase().includes('succeeded');
          const levelBadge = isError ? '[ERR]' : isSuccess ? '[OK]' : '[LOG]';
          return (
            <div key={`${entry}-${index}`} className={`log-line ${isError ? 'error' : isSuccess ? 'success' : 'info'}`}>
              {levelBadge} {entry}
            </div>
          );
        })}
      </div>
    </div>
  );
};
