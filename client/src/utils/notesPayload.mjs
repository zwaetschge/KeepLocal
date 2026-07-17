const DEFAULT_PAGINATION = { page: 1, limit: 50, total: 0, pages: 0 };
const DEFAULT_COUNTS = { active: 0, archived: 0 };

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asText(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function asNonNegativeNumber(value, fallback = 0) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function normalizeTodoItem(item) {
  if (!isRecord(item)) return null;

  return {
    ...item,
    text: asText(item.text),
    completed: Boolean(item.completed)
  };
}

function normalizeImage(image) {
  if (!isRecord(image)) return null;
  const url = asText(image.url);
  const thumbnailUrl = asText(image.thumbnailUrl);
  if (!url && !thumbnailUrl) return null;

  return {
    ...image,
    url,
    thumbnailUrl,
    filename: asText(image.filename, 'Bild')
  };
}

function normalizeLinkPreview(preview) {
  if (!isRecord(preview) || typeof preview.url !== 'string') return null;

  return {
    ...preview,
    url: preview.url,
    title: asText(preview.title),
    description: asText(preview.description),
    image: asText(preview.image),
    siteName: asText(preview.siteName)
  };
}

function normalizeSharedUser(user) {
  if (typeof user === 'string') return user;
  if (!isRecord(user)) return null;

  return {
    ...user,
    username: asText(user.username),
    email: asText(user.email)
  };
}

export function normalizeNote(note) {
  if (!isRecord(note)) return null;
  const id = asText(note._id, asText(note.id));
  if (!id) return null;

  return {
    ...note,
    _id: id,
    title: asText(note.title),
    content: asText(note.content),
    color: asText(note.color, '#ffffff'),
    isPinned: Boolean(note.isPinned),
    isArchived: Boolean(note.isArchived),
    isTodoList: Boolean(note.isTodoList),
    todoItems: Array.isArray(note.todoItems)
      ? note.todoItems.map(normalizeTodoItem).filter(Boolean)
      : [],
    tags: Array.isArray(note.tags)
      ? note.tags.filter(tag => typeof tag === 'string')
      : [],
    images: Array.isArray(note.images)
      ? note.images.map(normalizeImage).filter(Boolean)
      : [],
    linkPreviews: Array.isArray(note.linkPreviews)
      ? note.linkPreviews.map(normalizeLinkPreview).filter(Boolean)
      : [],
    sharedWith: Array.isArray(note.sharedWith)
      ? note.sharedWith.map(normalizeSharedUser).filter(Boolean)
      : []
  };
}

function normalizeTag(tag) {
  if (!isRecord(tag) || typeof tag.name !== 'string' || !tag.name) return null;

  return {
    ...tag,
    name: tag.name,
    count: asNonNegativeNumber(tag.count)
  };
}

export function normalizeNotesPayload(payload) {
  const source = isRecord(payload) ? payload : {};
  const pagination = isRecord(source.pagination) ? source.pagination : {};
  const counts = isRecord(source.counts) ? source.counts : {};

  return {
    notes: Array.isArray(source.notes)
      ? source.notes.map(normalizeNote).filter(Boolean)
      : [],
    pagination: {
      page: asNonNegativeNumber(pagination.page, DEFAULT_PAGINATION.page),
      limit: asNonNegativeNumber(pagination.limit, DEFAULT_PAGINATION.limit),
      total: asNonNegativeNumber(pagination.total, DEFAULT_PAGINATION.total),
      pages: asNonNegativeNumber(pagination.pages, DEFAULT_PAGINATION.pages)
    },
    counts: {
      active: asNonNegativeNumber(counts.active, DEFAULT_COUNTS.active),
      archived: asNonNegativeNumber(counts.archived, DEFAULT_COUNTS.archived)
    },
    tags: Array.isArray(source.tags)
      ? source.tags.map(normalizeTag).filter(Boolean)
      : []
  };
}
