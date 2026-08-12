import { describe, expect, it } from 'vitest';

const boundedRandom = (min: number, max: number) => {
  const value = Math.random() * (max - min) + min;
  return Math.round(value);
};

describe('boundedRandom', () => {
  it('stays within bounds', () => {
    for (let i = 0; i < 1000; i++) {
      const value = boundedRandom(300, 1200);
      expect(value).toBeGreaterThanOrEqual(300);
      expect(value).toBeLessThanOrEqual(1200);
    }
  });
});
