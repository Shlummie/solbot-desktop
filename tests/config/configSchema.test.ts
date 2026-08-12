import { describe, expect, it } from 'vitest';
import { configSchema, defaultConfig } from '@/shared/config';

describe('configSchema', () => {
  it('accepts the defaultConfig', () => {
    const result = configSchema.safeParse(defaultConfig);
    expect(result.success).toBe(true);
  });

  it('rejects invalid rpc urls', () => {
    const result = configSchema.safeParse({
      ...defaultConfig,
      rpc: {
        primary: 'http://not-https.com',
        fallbacks: ['not-a-url'],
      },
    });

    expect(result.success).toBe(false);
  });
});
