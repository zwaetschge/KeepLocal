const test = require('node:test');
const assert = require('node:assert/strict');
const { planEmailMigration } = require('../scripts/normalize-emails');

const user = (id, email) => ({ _id: id, email });

test('legacy non-canonical emails are planned for rewrite', () => {
  const { pending, collisions } = planEmailMigration([
    user('1', 'johndoe@gmail.com'),        // bereits kanonisch
    user('2', 'max.mustermann@gmail.com'), // Admin-Anlage, gepunktet
    user('3', 'Jane.Doe+Notes@GoogleMail.com'), // OAuth-Rohform
  ]);

  assert.equal(collisions.length, 0);
  assert.equal(pending.length, 2);
  assert.deepEqual(
    pending.map(entry => [entry.from, entry.to]),
    [
      ['max.mustermann@gmail.com', 'maxmustermann@gmail.com'],
      ['Jane.Doe+Notes@GoogleMail.com', 'janedoe@gmail.com'],
    ],
  );
});

test('users canonicalizing to the same address collide and are never rewritten', () => {
  const { pending, collisions } = planEmailMigration([
    user('1', 'johndoe@gmail.com'),
    user('2', 'john.doe@gmail.com'),
  ]);

  // Beide normalisieren auf johndoe@gmail.com — automatisches Umschreiben
  // würde den Unique-Index verletzen oder Konten verschmelzen.
  assert.equal(pending.length, 0);
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0].canonical, 'johndoe@gmail.com');
});

test('a user whose canonical form only they occupy is migrated', () => {
  const { pending, collisions } = planEmailMigration([
    user('1', 'jane.doe@gmail.com'),
  ]);

  assert.equal(collisions.length, 0);
  assert.deepEqual(pending.map(entry => entry.to), ['janedoe@gmail.com']);
});
