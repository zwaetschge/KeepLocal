const test = require('node:test');
const assert = require('node:assert/strict');

const { publicValidationErrors } = require('../utils/validationErrors');

test('validation errors never echo submitted values', () => {
  const errors = {
    array: () => [{
      type: 'field',
      value: 'SecretPassword123',
      msg: 'Passwort ist ungueltig',
      path: 'password',
      location: 'body',
      nestedErrors: [{ value: 'another-secret' }]
    }]
  };

  assert.deepEqual(publicValidationErrors(errors), [{
    type: 'field',
    msg: 'Passwort ist ungueltig',
    path: 'password',
    location: 'body'
  }]);
  assert.doesNotMatch(JSON.stringify(publicValidationErrors(errors)), /SecretPassword|another-secret/);
});
