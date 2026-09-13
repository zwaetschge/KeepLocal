const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

// Audit 2026-09-12 (Top-30 Nr. 25): supervisord startete crashende Programme
// endlos und ohne Backoff neu, und ein FATAL-Prozess änderte nichts am
// Container-Status — `docker ps` meldete „Up", während der API-Prozess tot war.
// Der Healthcheck wurde zwar rot, aber der Grund stand in einer Datei im
// Container-Layer, und `docker exec` funktioniert genau dann nicht, wenn der
// Container neu startet. Genau dieses Muster stand in UPGRADE_FIX_2026-09-12.md:
// Crash-Loop nach dem Juli-Update, sichtbar nur über die Logdatei.

const root = path.resolve(__dirname, '../..');
const supervisor = fs.readFileSync(path.join(root, 'supervisord.conf'), 'utf8');
const scriptPath = path.join(root, 'tools/supervisord-fatal-exit.sh');

function sendEvent(eventName, payload) {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keeplocal-listener-'));
    const shim = path.join(dir, 'kill-recorder.sh');
    fs.writeFileSync(shim, '#!/bin/sh\necho "$@" >> "$KILL_LOG"\n');
    fs.chmodSync(shim, 0o755);
    const killLog = path.join(dir, 'kills.log');

    const child = spawn('sh', [scriptPath], {
      env: { ...process.env, KEEPLOCAL_KILL_COMMAND: shim, KILL_LOG: killLog }
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ stdout, stderr, kills: readKills(), exited: false });
    }, 5000);

    const readKills = () => (fs.existsSync(killLog) ? fs.readFileSync(killLog, 'utf8').trim() : '');

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('exit', () => {
      clearTimeout(timer);
      resolve({ stdout, stderr, kills: readKills(), exited: true });
      fs.rmSync(dir, { recursive: true, force: true });
    });

    const header = `ver:3.0 server:supervisord serial:1 pool:fatal-exit poolserial:1 eventname:${eventName} len:${Buffer.byteLength(payload)}\n`;
    child.stdin.write(header);
    child.stdin.write(payload);
  });
}

test('crashing programs reach FATAL quickly instead of looping forever', () => {
  const programs = supervisor.match(/\[program:([a-z-]+)\]/g) || [];
  assert.equal(programs.length, 5);

  assert.doesNotMatch(supervisor, /startretries=10/, 'the old value let a crash loop for ~110s silently');
  const retries = supervisor.match(/startretries=(\d+)/g) || [];
  assert.equal(retries.length, 5, 'every program must declare its retries');
  assert.ok(retries.every(entry => Number(entry.split('=')[1]) <= 5), 'retries must stay bounded');
  assert.match(supervisor, /autorestart=true/);
});

test('a FATAL process ends the container instead of leaving it "Up"', () => {
  assert.match(supervisor, /\[eventlistener:fatal-exit\]/);
  assert.match(supervisor, /events=PROCESS_STATE_FATAL/);
  assert.match(supervisor, /command=\/usr\/local\/bin\/keeplocal-fatal-exit\.sh/);
  // Der Listener spricht über stdout mit supervisord — das Protokoll darf nicht
  // zusätzlich gespiegelt werden, sonst sieht supervisord eigene Logzeilen.
  assert.match(supervisor, /\[eventlistener:fatal-exit\][\s\S]*?stdout_logfile=\/dev\/null/);
  assert.match(supervisor, /\[eventlistener:fatal-exit\][\s\S]*?stderr_logfile=\/dev\/stderr/);

  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile.allinone'), 'utf8');
  assert.match(dockerfile, /COPY tools\/supervisord-fatal-exit\.sh \/usr\/local\/bin\/keeplocal-fatal-exit\.sh/);
  assert.match(dockerfile, /RUN chmod \+x \/usr\/local\/bin\/keeplocal-fatal-exit\.sh/);

  const stats = fs.statSync(scriptPath);
  assert.ok(stats.mode & 0o111, 'the listener must be executable in the repository too');
});

test('the listener answers the protocol and signals PID 1 on FATAL', async () => {
  const result = await sendEvent('PROCESS_STATE_FATAL', 'processname:nodejs groupname:nodejs state:FATAL');

  assert.match(result.stdout, /^READY/, 'the listener must announce itself first');
  assert.match(result.stdout, /RESULT 2\s*\nOK/, 'the event must be acknowledged');
  assert.equal(result.kills, '-TERM 1', 'PID 1 (supervisord) is asked to shut everything down');
  assert.equal(result.exited, true, 'the listener exits with the container');
  assert.match(result.stderr, /FATAL/, 'docker logs must name the reason');
  assert.match(result.stderr, /processname:nodejs/, 'docker logs must name the program');
});

test('other state changes do not touch the container', async () => {
  const result = await sendEvent('PROCESS_STATE_RUNNING', 'processname:nginx state:RUNNING');

  assert.equal(result.kills, '', 'a normal state change must not stop the container');
  assert.equal(result.exited, false, 'the listener keeps waiting for events');
  assert.equal((result.stdout.match(/READY/g) || []).length >= 2, true, 'it re-arms after every event');
});

test('the rollback documentation says which images crash-loop', () => {
  const dockerDocs = fs.readFileSync(path.join(root, 'docs/docker.md'), 'utf8');

  assert.match(dockerDocs, /## Rollback/);
  assert.match(dockerDocs, /index layout|Index-Layout|syncIndexes/i,
    'the docs must explain why pre-fix images crash-loop on a repaired database');
  assert.match(dockerDocs, /Restarting|restart loop|Crash-Loop|crash-loop/i,
    'operators must recognize the FATAL behaviour');
});
