/**
 * Speicher-Quota pro Nutzer (v1.16.0).
 *
 * Bis v1.15 kannte der Server nur Per-File-Limits (10 MB Bild, 25 MB PDF, 25
 * Anhänge pro Notiz) — kumuliert war ein Konto unbegrenzt: Ein Nutzer oder ein
 * Write-API-Key konnte das Volume des All-in-One-Images füllen, auf dem auch
 * mongod und die Backups leben. UPLOAD_QUOTA_MB (MB, positiv, 0/ungesetzt =
 * aus) deckelt die Summe aller Anhang-Bytes eines Nutzers.
 *
 * Gezählt werden files[].size und images[].size über ALLE Notizen inklusive
 * Papierkorb — die Dateien überleben das Soft-Delete bis zum Purge, eine Quota
 * nur für aktive Notizen wäre ein Einzeiler-Bypass. Bilder ohne size-Feld
 * (Bestand vor v1.16) zählen als 0 und wachsen durch Neuanlage nicht mehr.
 *
 * Check-then-write ist bewusst nicht atomar: Fünf parallele Uploads können die
 * Quota um bis zu 5×10 MB überschießen. Das Budget ist ein Schutz gegen
 * Volume-Volllauf, kein hartes Limit — ein atomarer $expr-Gegencheck müsste
 * bei jedem Upload über alle Anhangs-Arrays des Nutzers summieren.
 */

const Note = require('../models/Note');

/** Konfiguriertes Limit in Bytes; 0 = Quota aus (Voreinstellung, bestehende
 *  Installationen verhalten sich nach dem Upgrade exakt wie zuvor). */
function quotaLimitBytes() {
  const parsed = Number(process.env.UPLOAD_QUOTA_MB);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed * 1024 * 1024) : 0;
}

function quotaError(usedBytes, limitBytes) {
  const usedMb = (usedBytes / (1024 * 1024)).toFixed(1);
  const limitMb = Math.floor(limitBytes / (1024 * 1024));
  const error = new Error(
    `Speicher-Budget überschritten: belegt ${usedMb} MB von ${limitMb} MB. Bitte Anhänge löschen und erneut versuchen.`
  );
  error.statusCode = 413;
  error.code = 'STORAGE_QUOTA_EXCEEDED';
  return error;
}

/**
 * Summe aller Anhang-Bytes eines Nutzers (eine Aggregation, Projektion auf die
 * zwei Größen-Felder — kein Dokument-Material im Speicher).
 * @returns {Promise<number>} Bytes
 */
async function getStorageUsage(userId) {
  const [row] = await Note.aggregate([
    // Inklusive Papierkorb: Dateien überleben das Soft-Delete (siehe Kopf).
    { $match: { userId } },
    { $project: { files: 1, images: 1 } },
    { $group: {
      _id: null,
      bytes: {
        $sum: {
          $add: [
            { $sum: { $map: { input: { $ifNull: ['$files', []] }, as: 'file', in: { $ifNull: ['$$file.size', 0] } } } },
            { $sum: { $map: { input: { $ifNull: ['$images', []] }, as: 'image', in: { $ifNull: ['$$image.size', 0] } } } }
          ]
        }
      }
    } }
  ]);
  return row?.bytes ?? 0;
}

/**
 * Wirft 413 STORAGE_QUOTA_EXCEEDED, wenn Nutzung + additionalBytes das Limit
 * überschreiten. Ohne konfiguriertes Limit ein No-Op (auch keine Aggregation).
 * @param {string} userId
 * @param {number} additionalBytes - Bytes, die der Antrag zusätzlich belegen wird
 * @returns {Promise<{enforced: boolean, usedBytes: number, limitBytes: number}>}
 */
async function assertStorageQuota(userId, additionalBytes) {
  const limitBytes = quotaLimitBytes();
  if (!limitBytes) return { enforced: false, usedBytes: 0, limitBytes: 0 };
  if (!(additionalBytes > 0)) return { enforced: true, usedBytes: await getStorageUsage(userId), limitBytes };

  const usedBytes = await getStorageUsage(userId);
  if (usedBytes + additionalBytes > limitBytes) {
    throw quotaError(usedBytes, limitBytes);
  }
  return { enforced: true, usedBytes, limitBytes };
}

module.exports = {
  quotaLimitBytes,
  getStorageUsage,
  assertStorageQuota
};
