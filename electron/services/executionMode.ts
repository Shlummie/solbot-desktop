import type { AppConfig } from '@shared/config';

export const assertLiveExecution = (config: AppConfig, operation: string): void => {
  if (config.executionMode !== 'live') {
    throw new Error(
      `${operation} blocked because execution mode is dry-run. Review the transaction code, use disposable test wallets, and explicitly select live mode in Settings before submitting on-chain actions.`,
    );
  }
};
