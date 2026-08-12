import { describe, expect, it } from 'vitest';
import { defaultConfig } from '@/shared/config';

describe('defaultConfig', () => {
  it('blocks on-chain writes by default', () => {
    expect(defaultConfig.executionMode).toBe('dry-run');
  });

  it('includes scheduler cycleMs configuration', () => {
    expect(defaultConfig.limits.cycleMs).toBeGreaterThanOrEqual(500);
  });
});
