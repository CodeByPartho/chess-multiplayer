// jsdom lacks a few browser APIs used by libs under test
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.randomUUID) {
  const { randomUUID } = await import('node:crypto')
  Object.defineProperty(globalThis, 'crypto', { value: { randomUUID }, configurable: true })
}
export {}
