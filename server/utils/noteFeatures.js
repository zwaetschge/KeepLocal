const BACKGROUNDS = ['none', 'grid', 'lines', 'dots', 'leaves', 'sand'];
const MARKS = ['bold', 'italic', 'underline', 'h1', 'h2'];
function validateFeatures(value, contentLength = 10000) {
  const fail = () => {
    const e = new Error('Ungueltige Notizdarstellung');
    e.statusCode = 400;
    throw e;
  };
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    JSON.stringify(value).length > 250000
  )
    fail();
  const allowed = new Set([
    'format',
    'marks',
    'background',
    'drawing',
    'ocrText',
    'list',
  ]);
  if (Object.keys(value).some((k) => !allowed.has(k))) fail();
  if (value.format !== undefined && !['plain', 'rich'].includes(value.format))
    fail();
  if (value.background !== undefined && !BACKGROUNDS.includes(value.background))
    fail();
  if (
    value.ocrText !== undefined &&
    (typeof value.ocrText !== 'string' || value.ocrText.length > 10000)
  )
    fail();
  if (value.marks !== undefined) {
    if (!Array.isArray(value.marks) || value.marks.length > 1000) fail();
    for (const m of value.marks) {
      if (
        !m ||
        !MARKS.includes(m.type) ||
        !Number.isInteger(m.start) ||
        !Number.isInteger(m.end) ||
        m.start < 0 ||
        m.end <= m.start ||
        m.end > contentLength
      )
        fail();
    }
  }
  if (
    value.list !== undefined &&
    (!value.list ||
      typeof value.list !== 'object' ||
      Array.isArray(value.list) ||
      Object.entries(value.list).some(
        ([k, v]) =>
          !['checkedToBottom', 'addToTop', 'collapseCompleted'].includes(k) ||
          typeof v !== 'boolean',
      ))
  )
    fail();
  if (value.drawing !== undefined && value.drawing !== null) {
    const d = value.drawing;
    if (
      !d ||
      !Number.isInteger(d.width) ||
      !Number.isInteger(d.height) ||
      d.width < 1 ||
      d.height < 1 ||
      d.width > 4096 ||
      d.height > 4096 ||
      !Array.isArray(d.strokes) ||
      d.strokes.length > 500
    )
      fail();
    if (
      d.imageFilename !== undefined &&
      d.imageFilename !== null &&
      (typeof d.imageFilename !== 'string' ||
        !/^[\w.-]{1,150}$/.test(d.imageFilename))
    )
      fail();
    let points = 0;
    for (const s of d.strokes) {
      if (
        !s ||
        !/^#[0-9a-fA-F]{6}$/.test(s.color) ||
        !Number.isFinite(s.width) ||
        s.width < 1 ||
        s.width > 40 ||
        !Array.isArray(s.points)
      )
        fail();
      points += s.points.length;
      for (const p of s.points)
        if (
          !Array.isArray(p) ||
          p.length !== 2 ||
          p.some(
            (n, index) =>
              !Number.isFinite(n) ||
              n < 0 ||
              n > (index === 0 ? d.width : d.height),
          )
        )
          fail();
    }
    if (points > 20000) fail();
  }
}
function applySearchFilters(query, { type, color, person } = {}) {
  if (color) {
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
      const e = new Error('Ungueltige Farbe');
      e.statusCode = 400;
      throw e;
    }
    query.color = color;
  }
  const types = {
    lists: { isTodoList: true },
    text: { isTodoList: false },
    images: { 'images.0': { $exists: true } },
    reminders: { remindAt: { $ne: null } },
    pinned: { isPinned: true },
    drawings: { 'features.drawing.strokes.0': { $exists: true } },
    audio: { 'files.mimetype': /^audio\// },
  };
  if (type && type !== 'all') {
    if (!types[type]) {
      const e = new Error('Ungueltiger Notiztyp');
      e.statusCode = 400;
      throw e;
    }
    Object.assign(query, types[type]);
  }
  if (person) {
    if (!/^[0-9a-fA-F]{24}$/.test(person)) {
      const e = new Error('Ungueltige Person');
      e.statusCode = 400;
      throw e;
    }
    (query.$and ||= []).push({
      $or: [{ userId: person }, { sharedWith: person }],
    });
  }
  return query;
}
module.exports = { validateFeatures, applySearchFilters, BACKGROUNDS };
