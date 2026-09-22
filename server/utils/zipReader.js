/**
 * Minimal ZIP-Reader — das Gegenstueck zu utils/zipWriter.js.
 *
 * Anforderungsprofil ist der Markdown-Round-trip (v1.13.0): eigene Exporte
 * (STORE, UTF-8-Flag) und fremde ZIPs (Obsidian/Trilium-Ordner, meist DEFLATE)
 * muessen lesbar sein. Deshalb: zentrale Verzeichnisliste gehen, lokale Header
 * ueberspringen (Namen/Extras aus dem Zentraleintrag nehmen — die lokalen
 * Laengen duerfen abweichen), STORE kopieren, DEFLATE via inflateRawSync,
 * CRC32 gegenpruefen. Keine ZipCrypto-, Zip64- oder Multi-Disk-Unterstützung —
 * mit klaren Fehlern statt stillen Halbdaten.
 */

const zlib = require('zlib');

const EOCD_SIGNATURE = 0x06054b50;       // End of central directory
const CENTRAL_SIGNATURE = 0x02014b50;    // Central directory file header
const LOCAL_SIGNATURE = 0x04034b50;      // Local file header
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const EOCD_MIN_LENGTH = 22;
const MAX_COMMENT_LENGTH = 0xffff;
const ZIP64_MARKER = 0xffffffff;

// CRC32-Tabelle lazy — der Writer baut dieselbe, ein Reader ohne Lesefall
// soll dafuer nichts kosten.
let crcTable = null;
function getCrcTable() {
  if (crcTable) return crcTable;
  crcTable = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[n] = c;
  }
  return crcTable;
}

function crc32(buffer) {
  const table = getCrcTable();
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = (crc >>> 8) ^ table[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

/** EOCD rueckwaerts suchen: es ist die letzte Signatur, danach folgt maximal
 *  der Kommentar. Liest Eintrag-Anzahl und Offset des zentralen Verzeichnisses. */
function findEndOfCentralDirectory(buffer) {
  const earliest = Math.max(0, buffer.length - EOCD_MIN_LENGTH - MAX_COMMENT_LENGTH);
  for (let offset = buffer.length - EOCD_MIN_LENGTH; offset >= earliest; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== EOCD_SIGNATURE) continue;
    const entries = buffer.readUInt16LE(offset + 10);
    const centralOffset = buffer.readUInt32LE(offset + 16);
    if (centralOffset === ZIP64_MARKER || entries === ZIP64_MARKER) {
      throw new Error('ZIP64-Archive werden nicht unterstuetzt');
    }
    return { entries, centralOffset };
  }
  throw new Error('Ende des Archivs (EOCD) nicht gefunden');
}

/**
 * Alle Datei-Eintraege eines ZIP-Archivs lesen.
 * @param {Buffer} buffer - Rohdaten des Archivs
 * @returns {Map<string, Buffer>} Eintragsname → entpackter Inhalt (ohne Verzeichnisse)
 * @throws {Error} Mit Eintragsnamen versehene Fehler bei Beschädigung/unsupported Features
 */
function readZipEntries(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < EOCD_MIN_LENGTH) {
    throw new Error('Kein gueltiges ZIP-Archiv (zu kurz)');
  }

  const { entries: entryCount, centralOffset } = findEndOfCentralDirectory(buffer);
  const entries = new Map();

  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error(`Zentrales Verzeichnis beschädigt bei Eintrag ${index}`);
    }

    const method = buffer.readUInt16LE(offset + 10);
    const expectedCrc = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);

    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;

    if (compressedSize === ZIP64_MARKER || uncompressedSize === ZIP64_MARKER || localOffset === ZIP64_MARKER) {
      throw new Error(`ZIP64-Eintrag nicht unterstuetzt: ${name}`);
    }
    // Verzeichnis-Eintrage (Ende '/') haben keine Daten — ueberspringen, sie
    // sind nur Metadaten, die wir aus den Dateipfaden rekonstruieren.
    if (name.endsWith('/')) continue;

    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new Error(`Lokaler Header beschädigt: ${name}`);
    }
    // Datenstart aus den Laengen des LOKALEN Headers: Name- und Extra-Feld
    // duerfen zwischen lokal und zentral abweichen (manche Packer haengen
    // zentral zusaetzliche Extra-Felder an) — nur der lokale Header weiss, wo
    // die Daten wirklich beginnen.
    const dataStart = localOffset + 30 + localNameLength(buffer, localOffset) + localExtraLength(buffer, localOffset);
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) {
      throw new Error(`Daten ueber das Archivende hinaus: ${name}`);
    }
    const rawData = buffer.subarray(dataStart, dataEnd);

    let content;
    if (method === METHOD_STORE) {
      content = Buffer.from(rawData);
    } else if (method === METHOD_DEFLATE) {
      try {
        content = zlib.inflateRawSync(rawData);
      } catch (error) {
        throw new Error(`Eintrag liess sich nicht entpacken: ${name} (${error.message})`);
      }
    } else {
      throw new Error(`Kompressionsverfahren ${method} nicht unterstuetzt: ${name}`);
    }

    if (content.length !== uncompressedSize) {
      throw new Error(`Groesse passt nicht zur Angabe im Archiv: ${name}`);
    }
    if (crc32(content) !== expectedCrc) {
      throw new Error(`Pruefsumme stimmt nicht — Archiv beschädigt: ${name}`);
    }

    entries.set(name, content);
  }

  return entries;
}

/** Namens- und Extra-Feld-Laenge des lokalen Headers (Offset 26/28). */
function localNameLength(buffer, localOffset) {
  return buffer.readUInt16LE(localOffset + 26);
}

function localExtraLength(buffer, localOffset) {
  return buffer.readUInt16LE(localOffset + 28);
}

module.exports = { readZipEntries };
