import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NoteOutbox } from '../src/utils/noteOutbox.mjs';
import { moveChecklist, toggleChecklist } from '../src/utils/checklist.mjs';
import { shiftMarks, richSegments, searchMarks } from '../src/utils/richText.mjs';
function fixture() {
  let online = false;
  const store = new Map(),
    sent = [];
  const box = new NoteOutbox({
    load: async (k) => structuredClone(store.get(k)),
    save: async (k, v) => store.set(k, structuredClone(v)),
    online: () => online,
    id: () => 'stable-request',
    send: async (kind, id, body) => {
      sent.push({ kind, id, body });
      return {
        ...body,
        _id: kind === 'create' ? 'server-id' : id,
        updatedAt: '2026-10-27T13:00:00Z',
      };
    },
  });
  box.setOwner('alice');
  return { box, store, sent, setOnline: (v) => (online = v) };
}
test('offline create survives reload and coalesces edits, then replays once with a stable request id', async () => {
  const f = fixture();
  const n = await f.box.write('create', null, {
    title: 'Offline title',
    content: 'Hello',
  });
  await f.box.write('update', n._id, {
    content: 'Hello again',
    features: { format: 'rich', marks: [{ type: 'bold', start: 0, end: 5 }] },
  });
  assert.equal((await f.box.snapshot()).ops.length, 1);
  assert.equal(f.sent.length, 0);
  f.setOnline(true);
  await f.box.flush();
  await f.box.flush();
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].body.content, 'Hello again');
  assert.equal(f.sent[0].body.clientRequestId, 'stable-request');
  assert.equal((await f.box.snapshot()).ops.length, 0);
});
test('account switch prevents pending writes under the next account', async () => {
  const f = fixture();
  await f.box.write('create', null, { title: 'Alice' });
  f.box.setOwner('bob');
  f.setOnline(true);
  await f.box.flush();
  assert.equal(f.sent.length, 0);
  assert.equal((await f.box.snapshot()).ops.length, 0);
  f.box.setOwner('alice');
  assert.equal((await f.box.snapshot()).ops.length, 1);
});
test('a conflict blocks replay and preserves the local text for explicit resolution', async () => {
  const f = fixture();
  await f.box.cacheList('all', {
    notes: [{ _id: 'n', content: 'before', updatedAt: 'v1' }],
  });
  await f.box.write('update', 'n', {
    content: 'my draft',
    baseUpdatedAt: 'v1',
  });
  f.box.send = async () => {
    const error = new Error('Conflict');
    error.status = 409;
    throw error;
  };
  f.setOnline(true);
  await f.box.flush();
  const state = await f.box.snapshot();
  assert.equal(state.ops[0].error.status, 409);
  assert.equal(state.notes.n.content, 'my draft');
  const incoming = await f.box.cacheList('all', {
    notes: [{ _id: 'n', content: 'someone else', updatedAt: 'v2' }],
  });
  assert.equal(incoming.notes[0].content, 'my draft');
});
test('deleting an unsent new note cancels its create', async () => {
  const f = fixture();
  const n = await f.box.write('create', null, { title: 'draft' });
  await f.box.write('delete', n._id);
  assert.equal((await f.box.snapshot()).ops.length, 0);
});
test('moving and checking a parent preserve its children and identifiers', () => {
  const items = [
    { id: 'a', indent: 0, completed: false },
    { id: 'b', indent: 1, completed: false },
    { id: 'c', indent: 0, completed: false },
  ];
  assert.deepEqual(
    moveChecklist(items, 0, 2).map((i) => i.id),
    ['c', 'a', 'b'],
  );
  assert.deepEqual(
    toggleChecklist(items, 0).map((i) => i.completed),
    [true, true, false],
  );
});
test('rich marks retain UTF-16 offsets including emoji and adjust through edits', () => {
  const before = '👋 bold',
    marks = [{ type: 'bold', start: 3, end: 7 }];
  const shifted = shiftMarks(marks, before, 'Hi 👋 bold');
  assert.deepEqual(shifted, [{ type: 'bold', start: 6, end: 10 }]);
  assert.equal(
    richSegments('Hi 👋 bold', shifted).find((s) => s.types.includes('bold'))
      .text,
    'bold',
  );
});
test('formatting headings can be changed or removed without losing surrounding inline marks', async () => {
  const { formatMarks } = await import('../src/utils/richText.mjs');
  const text = 'Hello world';
  const marks = [
    { type: 'h1', start: 0, end: 11 },
    { type: 'bold', start: 0, end: 5 },
  ];
  const h2 = formatMarks(marks, text, 1, 3, 'h2');
  assert.equal(
    h2.some((m) => m.type === 'h1'),
    false,
  );
  assert.equal(
    h2.some((m) => m.type === 'h2'),
    true,
  );
  const plain = formatMarks(marks, text, 0, 11, 'plain');
  assert.deepEqual(plain, [{ type: 'bold', start: 0, end: 5 }]);
  const clear = formatMarks(marks, text, 0, 5, 'clear');
  assert.deepEqual(clear, [{ type: 'h1', start: 5, end: 11 }]);
});
test('offline overlay respects combined filters and never inserts new notes into the archive', async () => {
  const f = fixture();
  await f.box.cacheList('archived=true', { notes: [] });
  await f.box.cacheList('color=%23ccff90&type=lists', { notes: [] });
  await f.box.write('create', null, {
    title: 'Text',
    isArchived: false,
    color: '#ffffff',
  });
  assert.deepEqual((await f.box.cachedList('archived=true')).notes, []);
  assert.deepEqual(
    (await f.box.cachedList('color=%23ccff90&type=lists')).notes,
    [],
  );
});
test('LAN HTTP origins can create stable note keys without randomUUID', async () => {
  const { newLocalId } = await import('../src/utils/localId.mjs');
  const provider = {
    getRandomValues(array) {
      array.set([1, 2, 3, 4]);
      return array;
    },
  };
  assert.equal(newLocalId(provider), '00000001000000020000000300000004');
});
test('a late response from the previous account cannot enter the new account cache', async () => {
  const f = fixture();
  const owner = f.box.owner;
  f.box.setOwner('bob');
  await assert.rejects(
    f.box.cacheList(
      'all',
      { notes: [{ _id: 'private', content: 'Alice only' }] },
      owner,
    ),
    { code: 'ABORTED' },
  );
  await assert.rejects(
    f.box.cacheNote({ _id: 'private', content: 'Alice only' }, owner),
    { code: 'ABORTED' },
  );
  assert.deepEqual((await f.box.snapshot()).notes, {});
});

test('search highlights literal text across rich style boundaries without changing formatting', () => {
  const text = 'Tom <3 & bRoT + Brot';
  const styles = [{ type: 'bold', start: 10, end: 12 }];
  const segments = richSegments(text, [...styles, ...searchMarks(text, 'brot')]);
  assert.equal(segments.filter(s => s.types.includes('search')).map(s => s.text).join(''), 'bRoTBrot');
  assert.equal(segments.filter(s => s.types.includes('bold')).map(s => s.text).join(''), 'Ro');
  assert.deepEqual(searchMarks('a.*b aZZb', '.*'), [{ type: 'search', start: 1, end: 3 }]);
  assert.deepEqual(searchMarks(text, '  '), []);
});
