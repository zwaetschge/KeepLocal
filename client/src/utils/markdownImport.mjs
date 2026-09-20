/**
 * Markdown/Trilium-Import (v1.10.1): reine Vorbereitungs-Logik.
 *
 * Der Import lief vorher als Create-Request pro Datei direkt aus der
 * Settings-Komponente — untestbar und bei 300 Notizen eine 300-Request-
 * Sequenz. Diese Helfer bauen das items-Array fuer den Bulk-Endpoint
 * (POST /api/notes/import/markdown) und halten die Konventionen fest:
 * nur Text (.md/.markdown/.txt), 500 kB Datei-Cap, 10k Zeichen Content.
 */

export const IMPORT_FILE_PATTERN = /\.(md|markdown|txt)$/i;
export const IMPORT_MAX_FILE_BYTES = 500_000;
export const IMPORT_MAX_CONTENT_CHARS = 10_000;
export const IMPORT_CHUNK_SIZE = 500;

const relativePathOf = (file) => file.webkitRelativePath || file.name;

/**
 * Dateiliste → Bulk-Items. Binärdateien und Übertreiber werden übersprungen
 * (skipped zählt sie), alles andere behält seinen Ordnerpfad bei.
 *
 * @param {Array<{name: string, size: number, webkitRelativePath?: string}>} files
 * @param {{ readFile?: (file: any) => Promise<string> }} options — injectable für Tests
 * @returns {Promise<{ items: Array<{path: string, title: string, content: string}>, skipped: number }>}
 */
export async function buildMarkdownImportItems(files, { readFile = (file) => file.text() } = {}) {
  const eligible = (Array.isArray(files) ? files : []).filter((file) => (
    file
    && typeof file.name === 'string'
    && IMPORT_FILE_PATTERN.test(file.name)
    && typeof file.size === 'number'
    && file.size <= IMPORT_MAX_FILE_BYTES
  ));
  const skipped = (Array.isArray(files) ? files.length : 0) - eligible.length;

  // Eltern vor Kindern: identisch zur bisherigen Reihenfolge, damit der Baum
  // beim Anlegen schon stimmt (der Server resolutioniert zwar selbst, aber
  // die order-Werte in Datei-Reihenfolge sind so stabil).
  eligible.sort((a, b) => relativePathOf(a).localeCompare(relativePathOf(b)));

  const items = [];
  for (const file of eligible) {
    const segments = relativePathOf(file).split('/');
    const fileName = segments.pop();
    const folderPath = segments.join('/');
    const text = await readFile(file);

    let title = fileName.replace(IMPORT_FILE_PATTERN, '').trim().slice(0, 200);
    // index.md/_index.md (Trilium-Export-Konvention) trägt oft nur eine
    // Überschrift als Titel — dann die nehmen, sonst den Ordnernamen.
    if (title === 'index' || title === '_index') {
      const heading = /^#\s+(.+)$/m.exec(text);
      title = (heading ? heading[1] : segments[segments.length - 1] || 'Notiz').trim().slice(0, 200);
    }

    items.push({
      path: folderPath,
      title: title || 'Notiz',
      content: text.slice(0, IMPORT_MAX_CONTENT_CHARS)
    });
  }
  return { items, skipped };
}

/**
 * Items in Server-Chunks teilen (Endpoint-Cap: 500 pro Aufruf).
 * @returns {Array<Array<object>>}
 */
export function chunkImportItems(items, size = IMPORT_CHUNK_SIZE) {
  const chunkSize = Number.isInteger(size) && size > 0 ? size : IMPORT_CHUNK_SIZE;
  const chunks = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}
