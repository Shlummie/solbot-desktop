import { describe, expect, it } from 'vitest';
import { randomIntInRange, shuffle } from '@/shared/utils/random';

describe('randomIntInRange', () => {
  it('produces values within bounds', () => {
    for (let i = 0; i < 100; i++) {
      const value = randomIntInRange(3, 7);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(7);
    }
  });
});

describe('shuffle', () => {
  it('preserves elements', () => {
    const original = [1, 2, 3, 4, 5];
    const result = shuffle(original);
    expect(result).toHaveLength(original.length);
    for (const item of original) {
      expect(result).toContain(item);
    }
  });
});
