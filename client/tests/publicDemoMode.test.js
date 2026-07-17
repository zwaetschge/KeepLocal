const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const clientRoot = path.join(__dirname, '..');

function readClientFile(...parts) {
  return fs.readFileSync(path.join(clientRoot, ...parts), 'utf8');
}

test('demo login uses the cookie and CSRF protected auth flow', () => {
  const endpoints = readClientFile('src/constants/api.js');
  const api = readClientFile('src/services/api/authAPI.js');
  const context = readClientFile('src/contexts/AuthContext.jsx');

  assert.match(endpoints, /DEMO:\s*['"]\/api\/auth\/demo['"]/);
  assert.match(api, /demoLogin:\s*async\s*\(\)\s*=>/);
  assert.match(api, /API_ENDPOINTS\.AUTH\.DEMO/);
  assert.match(api, /method:\s*['"]POST['"]/);
  assert.match(api, /credentials:\s*['"]include['"]/);
  assert.match(api, /authCsrfHeaders\(\)/);
  assert.match(api, /requireUserPayload/);
  assert.match(context, /const demoLogin = async \(\) =>/);
  assert.match(context, /setUser\(response\.user\)/);
});

test('the public demo entry is discovered from providers and warns about shared data', () => {
  const login = readClientFile('src/components/Login.jsx');
  const de = readClientFile('src/translations/de.js');
  const en = readClientFile('src/translations/en.js');

  assert.match(login, /demo:\s*false/);
  assert.match(login, /oauthProviders\.demo && onDemoLogin/);
  assert.match(login, /className="demo-login-button"/);
  assert.match(login, /aria-describedby="demo-login-description"/);
  assert.match(de, /keine persönlichen oder vertraulichen Daten/i);
  assert.match(de, /für andere Tester sichtbar/i);
  assert.match(en, /do not enter personal or confidential information/i);
  assert.match(en, /visible to other testers/i);
});

test('authenticated demo mode stays visibly labelled and removes restricted entry points', () => {
  const app = readClientFile('src/App.jsx');
  const sidebar = readClientFile('src/components/Sidebar.jsx');
  const note = readClientFile('src/components/Note.jsx');
  const modal = readClientFile('src/components/NoteModal.jsx');

  assert.match(app, /user\?\.isDemo && \(\s*<section className="demo-banner"/);
  assert.match(app, /t\('demoBannerPrivacy'\)/);
  assert.match(app, /onSettingsClick=\{user\?\.isDemo \? undefined/);
  assert.match(app, /onOpenFriends=\{user\?\.isDemo \? undefined/);
  assert.match(app, /onOpenCollaborate=\{user\?\.isDemo \? undefined/);
  assert.match(app, /showSettings && !user\?\.isDemo/);
  assert.match(sidebar, /\{onOpenFriends && \(/);
  assert.match(note, /\{onOpenCollaborate && \(/);
  assert.match(modal, /useLinkPreview\(content, !isTodoList && !isDemo\)/);
  assert.match(modal, /!isDemo && note && images/);
  assert.match(modal, /!isDemo && note && settings\.aiFeatures\.voiceTranscription/);
});

test('demo call to action has a visible keyboard focus treatment', () => {
  const css = readClientFile('src/components/Auth.css');
  const match = css.match(/\.demo-login-button:focus-visible\s*\{([^}]*)\}/m);

  assert.ok(match, 'demo login focus-visible rule is missing');
  assert.match(match[1], /outline:\s*3px solid #49B6E5/);
  assert.match(match[1], /outline-offset:\s*3px/);
});
