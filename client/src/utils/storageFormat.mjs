/**
 * Bytes menschenlesbar formatieren (v1.17.0 Nr. 11 — Quota-Anzeige).
 * Binärpräfixe (1024er-Schritte), eine Nachkommastelle, ohne führende 0
 * vor dem Komma bei Werten unter 1 KB („512 B", „42,5 KB", „3,1 GB").
 * Reine Funktion, damit die Darstellung in tests/StorageFormat.test.js
 * ausführbar bleibt.
 */
export function formatStorageBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return '0 B';
  if (value < 1024) return `${Math.round(value)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let scaled = value / 1024;
  let unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  const rounded = scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

/**
 * Anteil in Prozent (0–100) für den Quota-Balken, geklemmt auf [0, 100];
 * unlimitierte Konten (limit 0) melden null — der Aufrufer zeigt dann keinen
 * Balken, nur die Nutzung.
 */
export function storagePercent(usedBytes, limitBytes) {
  const used = Number(usedBytes);
  const limit = Number(limitBytes);
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
}
