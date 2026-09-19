// Minimaler ZIP-Writer (v1.10.0) für den Markdown-Export — bewusst ohne
// Fremd-Paket: Der Server bekommt dadurch keine neue Supply-Chain-Abhängigkeit
// für ein Feature, das nur einmal pro Export-Click läuft.
//
// Gespeichert wird unkomprimiert (Methode 0 „store"): Markdown verkleinert sich
// durch Deflate kaum, und so bleibt der Writer ~90 Zeilen statt eines
// Kompressions-Stacks. Das Archiv ist dennoch ein normales ZIP, das jedes
// Entpack-Tool und Triliums Markdown-Import lesen können.
//
// Aufbau pro Eintrag: Local File Header + (unkomprimierte) Daten, danach
// zentral das Central Directory und der End-of-Central-Directory-Block —
// exakt die Reihenfolge, die APPNOTE.TXT vorschreibt.

/** CRC-32 (IEEE 802.3, reflektiert) — Tabelle einmalig, dann 8 Bit pro Byte. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

class ZipWriter {
  constructor() {
    this.entries = []; // { nameBuffer, data, crc, offset }
    this.offset = 0;
    this.chunks = [];
  }

  /**
   * Dateiinhalt puffern. `data` wird kopiert, danach darf der Caller das
   * Buffer-Objekt weiterverwenden.
   * @param {string} name - Pfad im Archiv, '/' trennt Verzeichnisse.
   * @param {string|Buffer} data
   */
  add(name, data) {
    const nameBuffer = Buffer.from(name, 'utf8');
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    this.entries.push({
      nameBuffer,
      data: payload,
      crc: crc32(payload),
      offset: this.offset
    });
    this.offset += 30 + nameBuffer.length + payload.length;
    this.chunks.push({ nameBuffer, data: payload });
    return this;
  }

  /** Fertiges Archiv als Buffer (local headers + central directory + EOCD). */
  finish() {
    const parts = [];
    const central = [];

    for (const entry of this.entries) {
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);  // signature
      local.writeUInt16LE(20, 4);          // version needed
      local.writeUInt16LE(0x0800, 6);      // flags: UTF-8 names
      local.writeUInt16LE(0, 8);           // method: store
      local.writeUInt16LE(0, 10);          // mod time
      local.writeUInt16LE(0x21, 12);       // mod date (1980-01-01, valide DOS-Zeit)
      local.writeUInt32LE(entry.crc, 14);
      local.writeUInt32LE(entry.data.length, 18); // compressed
      local.writeUInt32LE(entry.data.length, 22); // uncompressed
      local.writeUInt16LE(entry.nameBuffer.length, 26);
      local.writeUInt16LE(0, 28);          // extra length
      parts.push(local, entry.nameBuffer, entry.data);

      const dir = Buffer.alloc(46);
      dir.writeUInt32LE(0x02014b50, 0);    // signature
      dir.writeUInt16LE(20, 4);            // version made by
      dir.writeUInt16LE(20, 6);            // version needed
      dir.writeUInt16LE(0x0800, 8);        // flags: UTF-8
      dir.writeUInt16LE(0, 10);            // method: store
      dir.writeUInt16LE(0, 12);            // mod time
      dir.writeUInt16LE(0x21, 14);         // mod date
      dir.writeUInt32LE(entry.crc, 16);
      dir.writeUInt32LE(entry.data.length, 20);
      dir.writeUInt32LE(entry.data.length, 24);
      dir.writeUInt16LE(entry.nameBuffer.length, 28);
      dir.writeUInt16LE(0, 30);            // extra
      dir.writeUInt16LE(0, 32);            // comment
      dir.writeUInt16LE(0, 34);            // disk number
      dir.writeUInt16LE(0, 36);            // internal attrs
      dir.writeUInt32LE(0, 38);            // external attrs
      dir.writeUInt32LE(entry.offset, 42);
      central.push(dir, entry.nameBuffer);
    }

    const centralBuffer = Buffer.concat(central);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);              // disk number
    eocd.writeUInt16LE(0, 6);              // start disk
    eocd.writeUInt16LE(this.entries.length, 8);
    eocd.writeUInt16LE(this.entries.length, 10);
    eocd.writeUInt32LE(centralBuffer.length, 12);
    eocd.writeUInt32LE(this.offset, 16);   // central dir offset
    eocd.writeUInt16LE(0, 20);             // comment length

    return Buffer.concat([...parts, centralBuffer, eocd]);
  }
}

module.exports = { ZipWriter, crc32 };
