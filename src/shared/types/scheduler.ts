export type RpcEndpointStats = {
  url: string;
  failureCount: number;
  averageLatencyMs: number;
  lastLatencyMs: number | null;
  totalRequests: number;
  throttled: number;
  rateLimitBackoffs: number;
  inFlight: number;
  qpsLimit: number;
  recentQps: number;
};

export type RpcHealthSnapshot = {
  collectedAt: string;
  endpoints: RpcEndpointStats[];
};

export type SchedulerStatus = {
  running: boolean;
  killSwitch: boolean;
  pausedWallets: string[];
};

