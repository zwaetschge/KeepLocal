const mongoose = require('mongoose');
const Note = require('../models/Note');
const Organization = require('../models/NoteOrganization');
const { applySearchFilters } = require('../utils/noteFeatures');
const fields = ['color', 'tags', 'isPinned', 'isArchived'];
function ownId(note) {
  return String(note.userId?._id || note.userId);
}
function defaults(note, userId) {
  return ownId(note) === String(userId)
    ? {
        color: note.color,
        tags: note.tags || [],
        isPinned: Boolean(note.isPinned),
        isArchived: Boolean(note.isArchived),
      }
    : { color: '#ffffff', tags: [], isPinned: false, isArchived: false };
}
async function projectNote(note, userId) {
  const plain =
    typeof note.toObject === 'function' ? note.toObject() : { ...note };
  const personal = await Organization.findOne({
    noteId: note._id,
    userId,
  }).lean();
  return {
    ...plain,
    ...defaults(plain, userId),
    ...Object.fromEntries(
      fields
        .filter((k) => personal?.[k] !== undefined)
        .map((k) => [k, personal[k]]),
    ),
  };
}
async function saveOrganization(note, userId, data) {
  const values = Object.fromEntries(
    fields.filter((k) => data[k] !== undefined).map((k) => [k, data[k]]),
  );
  if (!Object.keys(values).length) return;
  // Exact unique-key filter; never add a conditional predicate to this upsert.
  try {
    await Organization.updateOne(
      { userId, noteId: note._id },
      { $set: values },
      { upsert: true, runValidators: true },
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
    await Organization.updateOne(
      { userId, noteId: note._id },
      { $set: values },
      { runValidators: true },
    );
  }
}
async function getPersonalNotes({
  userId,
  search,
  tag,
  type,
  color,
  person,
  page = 1,
  limit = 50,
  archived = 'false',
  deleted = 'false',
  folderId,
  since,
  includeMeta = true,
}) {
  const uid = new mongoose.Types.ObjectId(String(userId));
  const p = Math.max(1, Number.isSafeInteger(Number(page)) ? Number(page) : 1);
  const size = Math.min(
    100,
    Math.max(1, Number.isInteger(Number(limit)) ? Number(limit) : 50),
  );
  const trash = deleted === true || deleted === 'true';
  const isArchived = archived === true || archived === 'true';
  const filter = trash
    ? { userId: uid, deletedAt: { $ne: null } }
    : { deletedAt: null, isArchived };
  if (tag)
    filter.tags = {
      $regex: new RegExp(
        `^${String(tag).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
        'i',
      ),
    };
  applySearchFilters(filter, { type, color, person });
  if (person)
    filter.$and = filter.$and.map((clause) => ({
      $or: clause.$or.map((obj) =>
        Object.fromEntries(
          Object.entries(obj).map(([k, v]) => [
            k,
            new mongoose.Types.ObjectId(v),
          ]),
        ),
      ),
    }));
  if (folderId) {
    if (folderId !== 'root' && !/^[a-f0-9]{24}$/i.test(folderId)) {
      const e = new Error('Ungueltiger Ordner');
      e.statusCode = 400;
      throw e;
    }
    filter.parentId =
      folderId === 'root' ? null : new mongoose.Types.ObjectId(folderId);
  }
  if (since) {
    const date = new Date(since);
    if (Number.isNaN(date.getTime())) {
      const e = new Error('Ungueltiger Zeitpunkt');
      e.statusCode = 400;
      throw e;
    }
    filter[trash ? 'deletedAt' : 'updatedAt'] = { $gte: date };
  }
  const term = typeof search === 'string' ? search.trim().slice(0, 100) : '';

  const set = {};
  for (const key of fields)
    set[key] = {
      $ifNull: [
        `$personal.${key}`,
        {
          $cond: [
            { $eq: ['$userId', uid] },
            `$${key}`,
            { color: '#ffffff', tags: [], isPinned: false, isArchived: false }[
              key
            ],
          ],
        },
      ],
    };
  const [result] = await Note.aggregate([
    {
      $match: {
        $or: [{ userId: uid }, { sharedWith: uid }],
        ...(term ? { $text: { $search: term } } : {}),
      },
    },
    ...(term ? [{ $set: { score: { $meta: 'textScore' } } }] : []),
    {
      $lookup: {
        from: Organization.collection.name,
        let: { noteId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$noteId', '$$noteId'] },
                  { $eq: ['$userId', uid] },
                ],
              },
            },
          },
        ],
        as: 'personal',
      },
    },
    { $set: { personal: { $arrayElemAt: ['$personal', 0] } } },
    { $set: set },
    { $unset: ['personal', 'revisions'] },
    {
      $facet: {
        rows: [
          { $match: filter },
          {
            $sort: trash
              ? { deletedAt: -1, _id: -1 }
              : term
                ? { isPinned: -1, score: -1, _id: -1 }
                : { isPinned: -1, order: -1, updatedAt: -1, _id: -1 },
          },
          { $skip: (p - 1) * size },
          { $limit: size },
        ],
        total: [{ $match: filter }, { $count: 'value' }],
        counts: [
          {
            $group: {
              _id: null,
              active: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: [{ $ifNull: ['$deletedAt', null] }, null] },
                        { $eq: ['$isArchived', false] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              archived: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: [{ $ifNull: ['$deletedAt', null] }, null] },
                        { $eq: ['$isArchived', true] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              trash: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $ne: [{ $ifNull: ['$deletedAt', null] }, null] },
                        { $eq: ['$userId', uid] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ],
        tags: [
          { $match: { deletedAt: null } },
          { $unwind: '$tags' },
          { $group: { _id: '$tags', count: { $sum: 1 } } },
          { $sort: { _id: 1 } },
          { $project: { _id: 0, name: '$_id', count: 1 } },
        ],
      },
    },
  ]);
  const notes = await Note.populate(result.rows, [
    { path: 'userId', select: 'username email' },
    { path: 'sharedWith', select: 'username email' },
    { path: 'lastEditedBy', select: 'username' },
  ]);
  const total = result.total[0]?.value || 0;
  const response = {
    notes,
    pagination: { page: p, limit: size, total, pages: Math.ceil(total / size) },
  };
  if (includeMeta !== false && includeMeta !== 'false') {
    response.counts = {
      active: result.counts[0]?.active || 0,
      archived: result.counts[0]?.archived || 0,
      trash: result.counts[0]?.trash || 0,
    };
    response.tags = result.tags;
    if (term)
      response.counts = (await getPersonalNotes({ userId, limit: 1 })).counts;
  }
  return response;
}
async function projectMany(notes, userId) {
  const rows = await Organization.find({
    userId,
    noteId: { $in: notes.map((n) => n._id) },
  }).lean();
  const map = new Map(rows.map((row) => [String(row.noteId), row]));
  return notes.map((n) => {
    const plain = typeof n.toObject === 'function' ? n.toObject() : n;
    const org = map.get(String(n._id));
    return {
      ...plain,
      ...defaults(plain, userId),
      ...Object.fromEntries(
        fields.filter((k) => org?.[k] !== undefined).map((k) => [k, org[k]]),
      ),
    };
  });
}
module.exports = {
  getPersonalNotes,
  projectNote,
  projectMany,
  saveOrganization,
};
