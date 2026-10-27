import { newLocalId } from './localId.mjs';
// One durable account record: cache and pending writes commit together.
export class NoteOutbox {
  constructor({
    load,
    save,
    send,
    notify = () => {},
    online = () => true,
    id = () => newLocalId(),
  }) {
    Object.assign(this, { load, save, send, notify, online, id });
    this.owner = null;
    this.tail = Promise.resolve();
  }
  setOwner(owner) {
    this.owner = owner || null;
    this.notify();
  }
  run(action, quiet = false) {
    const owner = this.owner;
    if (!owner) return action(null, null);
    const next = this.tail
      .catch(() => {})
      .then(async () => {
        let state;
        try {
          state = (await this.load(owner)) || { notes: {}, lists: {}, ops: [] };
        } catch (_) {
          state = null;
        }
        const result = await action(state, owner);
        if (state && !quiet) {
          try {
            await this.save(owner, state);
          } catch (error) {
            if (result?._pending || result === undefined) throw error;
          }
        }
        if (!quiet) this.notify(state, owner);
        return result;
      });
    this.tail = next;
    return next;
  }

  assertOwner(owner) {
    if (owner !== this.owner)
      throw Object.assign(new Error('Sitzung gewechselt'), { code: 'ABORTED' });
  }
  async cacheList(key, response, owner = this.owner) {
    this.assertOwner(owner);
    return this.run((state) => {
      this.assertOwner(owner);
      if (!state) return response;
      for (const n of response.notes || [])
        if (!state.ops.some((op) => op.id === n._id)) state.notes[n._id] = n;
      state.lists[key] = response;
      return this.overlay(state, response, key);
    });
  }
  overlay(state, response, key = '') {
    const params = new URLSearchParams(key),
      map = new Map((response.notes || []).map((n) => [n._id, n]));
    const matches = (note) => {
      if (
        Boolean(note.isArchived) !== (params.get('archived') === 'true') ||
        Boolean(note.deletedAt) !== (params.get('deleted') === 'true')
      )
        return false;
      if (params.get('color') && note.color !== params.get('color'))
        return false;
      if (
        params.get('tag') &&
        !(note.tags || []).some(
          (tag) => tag.toLowerCase() === params.get('tag').toLowerCase(),
        )
      )
        return false;
      if (
        params.get('folderId') &&
        (note.parentId || 'root') !== params.get('folderId')
      )
        return false;
      const type = params.get('type');
      if (
        (type === 'lists' && !note.isTodoList) ||
        (type === 'text' && note.isTodoList) ||
        (type === 'images' && !note.images?.length) ||
        (type === 'pinned' && !note.isPinned) ||
        (type === 'reminders' && !note.remindAt) ||
        (type === 'drawings' && !note.features?.drawing?.strokes?.length) ||
        (type === 'audio' &&
          !note.files?.some((file) => file.mimetype?.startsWith('audio/')))
      )
        return false;
      const person = params.get('person');
      if (
        person &&
        String(note.userId?._id || note.userId) !== person &&
        !note.sharedWith?.some(
          (user) => String(user._id || user.userId || user) === person,
        )
      )
        return false;
      const term = params.get('search')?.trim().toLowerCase();
      if (
        term &&
        ![
          note.title,
          note.content,
          note.features?.ocrText,
          ...(note.todoItems || []).map((item) => item.text),
        ]
          .join(' ')
          .toLowerCase()
          .includes(term)
      )
        return false;
      return true;
    };
    for (const op of state.ops) {
      if (op.kind === 'delete') {
        map.delete(op.id);
        continue;
      }
      if (
        map.has(op.id) ||
        (op.kind === 'create' && Number(params.get('page') || 1) === 1)
      ) {
        const note = state.notes[op.id];
        if (note && matches(note)) map.set(op.id, note);
        else map.delete(op.id);
      }
    }
    return { ...response, notes: [...map.values()] };
  }

  async cachedList(key, owner = this.owner) {
    this.assertOwner(owner);
    return this.run((state) => {
      this.assertOwner(owner);
      if (!state?.lists[key])
        throw new TypeError('Offline: diese Ansicht wurde noch nicht geladen');
      return this.overlay(state, state.lists[key], key);
    });
  }
  async cachedNote(id, owner = this.owner) {
    this.assertOwner(owner);
    return this.run((state) => {
      this.assertOwner(owner);
      if (!state?.notes[id])
        throw new TypeError('Offline: diese Notiz wurde noch nicht geladen');
      return state.notes[id];
    });
  }
  async cacheNote(note, owner = this.owner) {
    this.assertOwner(owner);
    return this.run((state) => {
      this.assertOwner(owner);
      if (state?.ops.some((op) => op.id === note._id))
        return state.notes[note._id] || note;
      if (state) state.notes[note._id] = note;
      return note;
    });
  }
  async resolveId(id) {
    return this.run((state) => state?.aliases?.[id] || id, true);
  }
  async write(kind, id, body = {}) {
    return this.run(async (state, owner) => {
      if (!owner) throw new Error('Keine aktive Sitzung');
      if (!state) {
        if (this.online())
          return this.send(
            kind,
            id,
            kind === 'create'
              ? { ...body, clientRequestId: body.clientRequestId || this.id() }
              : body,
          );
        throw new Error(
          'Lokaler Speicher ist nicht verfügbar. Der Entwurf bleibt geöffnet.',
        );
      }
      const originalId = id;
      id = state.aliases?.[id] || id;
      if (originalId !== id && kind === 'update')
        body = {
          ...body,
          baseUpdatedAt:
            state.aliasVersions?.[originalId] || body.baseUpdatedAt,
        };
      const requestId =
        kind === 'create' ? body.clientRequestId || this.id() : undefined;
      const data =
        kind === 'create' ? { ...body, clientRequestId: requestId } : body;
      if (this.owner !== owner) {
        const error = new Error('Sitzung gewechselt');
        error.code = 'ABORTED';
        throw error;
      }
      if (this.online() && !String(id).startsWith('local_')) {
        try {
          const note = await this.send(kind, id, data);
          state.ops = state.ops.filter((op) => op.id !== id);
          if (note?._id) state.notes[note._id] = note;
          return note;
        } catch (error) {
          if (error.status || error.code === 'ABORTED') throw error;
        }
      }
      const key = id || `local_${requestId}`;
      const previous = state.notes[key] || {};
      const pending = state.ops.find((op) => op.id === key);
      if (kind === 'delete' && pending?.kind === 'create') {
        state.ops = state.ops.filter((op) => op.id !== key);
        delete state.notes[key];
        return {};
      }
      if (pending && kind === 'update') {
        pending.body = {
          ...pending.body,
          ...data,
          baseUpdatedAt: data.baseUpdatedAt || pending.body.baseUpdatedAt,
        };
        delete pending.error;
      } else state.ops.push({ kind, id: key, body: data });
      const now = new Date().toISOString();
      const note = {
        images: [],
        files: [],
        tags: [],
        isPinned: false,
        isArchived: false,
        ...previous,
        ...data,
        _id: key,
        userId: previous.userId || owner,
        createdAt: previous.createdAt || now,
        updatedAt: previous.updatedAt || now,
        _pending: true,
      };
      if (kind === 'delete') delete state.notes[key];
      else state.notes[key] = note;
      return kind === 'delete' ? {} : note;
    });
  }
  async flush() {
    return this.run(async (state, owner) => {
      if (!state || !this.online()) return;
      while (state.ops.length && this.owner === owner) {
        const op = state.ops[0];
        try {
          const note = await this.send(op.kind, op.id, op.body);
          state.ops.shift();
          if (note?._id) {
            if (op.kind === 'create') {
              (state.aliases ||= {})[op.id] = note._id;
              (state.aliasVersions ||= {})[op.id] = note.updatedAt;
            }
            delete state.notes[op.id];
            state.notes[note._id] = note;
            for (const later of state.ops) {
              if (later.id === op.id) {
                later.id = note._id;
                later.body.baseUpdatedAt = note.updatedAt;
              }
            }
          }
          // Persist each acknowledgement so a later interruption only replays the unacknowledged write.
          await this.save(owner, state);
        } catch (error) {
          if (error.status) {
            op.error = { status: error.status, message: error.message };
          }
          break;
        }
      }
    });
  }
  async snapshot() {
    return this.run(
      (state) => structuredClone(state || { notes: {}, lists: {}, ops: [] }),
      true,
    );
  }
  async discard(id) {
    return this.run((state) => {
      if (state) {
        state.ops = state.ops.filter((op) => op.id !== id);
        delete state.notes[id];
        state.lists = {};
      }
    });
  }
}
