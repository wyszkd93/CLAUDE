// 결정적 해시(FNV-1a 32비트). 같은 seed 는 어디서나 같은 값을 낸다. 암호용이 아니다.
export function seedHash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function pick<T>(items: readonly T[], seed: string): T | undefined {
  return items.length === 0 ? undefined : items[seedHash(seed) % items.length];
}
