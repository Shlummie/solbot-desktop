const makeSeedGenerator = (seed: number) => {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
};

let overrideRandom: (() => number) | undefined;

export const setRandomSeed = (seed: number | undefined) => {
  overrideRandom = typeof seed === 'number' ? makeSeedGenerator(seed) : undefined;
};

const nextRandom = () => (overrideRandom ? overrideRandom() : Math.random());

export const randomInRange = (min: number, max: number) => nextRandom() * (max - min) + min;

export const randomIntInRange = (min: number, max: number) =>
  Math.floor(randomInRange(min, max + 1));

export const randomDelay = async (minMs: number, maxMs: number) => {
  const delay = randomInRange(minMs, maxMs);
  await new Promise((resolve) => setTimeout(resolve, delay));
};

export const shuffle = <T>(input: T[]): T[] => {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(nextRandom() * (i + 1));
    const temp = arr[i];
    arr[i] = arr[j] as T;
    arr[j] = temp as T;
  }
  return arr;
};
