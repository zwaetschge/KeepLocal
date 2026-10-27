// randomUUID is unavailable on ordinary HTTP LAN origins. IDs are opaque
// synchronization keys, independent of MongoDB document identifiers.
export function newLocalId(provider = globalThis.crypto) {
  if (provider?.randomUUID) return provider.randomUUID();
  const words = new Uint32Array(4);
  if (provider?.getRandomValues) provider.getRandomValues(words);
  else
    for (let i = 0; i < words.length; i++)
      words[i] = Math.floor(Math.random() * 0x100000000);
  return Array.from(words, (n) => n.toString(16).padStart(8, '0')).join('');
}
