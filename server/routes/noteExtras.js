const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const sharp = require('sharp');
const notes = require('../services/notesService');
const { imagesDir, filesDir, tempDir } = require('../config/paths');
const { uploadAudio, isSafeStoredFilename } = require('../middleware/upload');
const {
  wrapUpload,
  requireEditableNote,
  rejectIfAttachmentFull,
} = require('../utils/attachmentUpload');
const { validateAudioFile } = require('../utils/magicNumberValidator');
const { assertStorageQuota } = require('../utils/storageQuota');
const { acquire } = require('../utils/concurrencyGate');
const { blockDemoUser } = require('../middleware/demoPolicy');
const run = promisify(execFile);

module.exports = function mountNoteExtras(
  router,
  { writeGuard = (_req, _res, next) => next(), versioned = false } = {},
) {
  const reply = (res, payload) =>
    res.json(versioned ? { success: true, data: payload } : payload);
  const validateId = (req, res, next) =>
    /^[0-9a-fA-F]{24}$/.test(req.params.id)
      ? next()
      : res.status(400).json({ error: 'Ungueltige Notiz-ID' });
  router.post(
    '/:id/images/:filename/text',
    writeGuard,
    blockDemoUser('uploads'),
    validateId,
    async (req, res, next) => {
      let gate, globalGate, temporary;
      try {
        const note = await notes.getEditableNoteById(
          req.params.id,
          req.user._id,
        );
        if (
          !isSafeStoredFilename(req.params.filename) ||
          !note.images.some((i) => i.filename === req.params.filename)
        )
          return res.status(404).json({ error: 'Bild nicht gefunden' });
        gate = acquire(`ocr:${req.user._id}`, 1);
        globalGate = acquire('ocr:global', 2);
        if (!gate.acquired || !globalGate.acquired) {
          res.setHeader('Retry-After', '10');
          return res
            .status(429)
            .json({ error: 'Texterkennung ist ausgelastet', code: 'OCR_BUSY' });
        }
        temporary = path.join(tempDir(), `${crypto.randomUUID()}.png`);
        await sharp(path.join(imagesDir(), req.params.filename), {
          limitInputPixels: 40000000,
        })
          .rotate()
          .resize({
            width: 2000,
            height: 2000,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .png()
          .toFile(temporary);
        const language = /^[a-z_+]+$/.test(process.env.OCR_LANGUAGES || '')
          ? process.env.OCR_LANGUAGES
          : 'eng+deu';
        const { stdout } = await run(
          'tesseract',
          [temporary, 'stdout', '-l', language],
          {
            timeout: 45000,
            maxBuffer: 1024 * 1024,
            env: { ...process.env, OMP_THREAD_LIMIT: '1' },
          },
        );
        reply(res, { text: stdout.trim().slice(0, 10000) });
      } catch (e) {
        if (e.code === 'ENOENT' || e.killed) {
          e.statusCode = 503;
          e.message = 'Texterkennung ist momentan nicht verfügbar';
        }
        next(e);
      } finally {
        gate?.release?.();
        globalGate?.release?.();
        if (temporary) await fs.unlink(temporary).catch(() => {});
      }
    },
  );
  router.post(
    '/:id/recordings',
    writeGuard,
    blockDemoUser('uploads'),
    validateId,
    requireEditableNote,
    rejectIfAttachmentFull('files'),
    wrapUpload(uploadAudio.single('audio'), {
      sizeLabel: '25MB',
      kindLabel: 'Audio',
    }),
    async (req, res, next) => {
      let destination,
        committed = false;
      try {
        if (!req.file || !(await validateAudioFile(req.file.path)))
          return res.status(400).json({ error: 'Ungueltige Audiodatei' });
        await assertStorageQuota(req.ownedNote.userId, req.file.size);
        destination = path.join(filesDir(), req.file.filename);
        await fs.rename(req.file.path, destination);
        const note = await notes.addFiles(req.params.id, req.user._id, [
          {
            filename: req.file.filename,
            url: `/uploads/files/${req.file.filename}`,
            originalName: path.basename(req.file.originalname).slice(0, 255),
            mimetype: req.file.mimetype.replace(/^video\//, 'audio/'),
            size: req.file.size,
            uploadedAt: new Date(),
          },
        ]);
        committed = true;
        reply(res,req.query.personal==='true'?await require('../services/noteOrganization').projectNote(note,req.user._id):note);
      } catch (e) {
        next(e);
      } finally {
        if (req.file) await fs.unlink(req.file.path).catch(() => {});
        if (destination && !committed)
          await fs.unlink(destination).catch(() => {});
      }
    },
  );
};
