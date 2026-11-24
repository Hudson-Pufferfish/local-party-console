#!/usr/bin/env node
// Drives the local party console for verification. Kills only processes it records.

import { execFile, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const REPO = path.resolve(import.meta.dirname, '../../../..');
const SKILL = path.resolve(import.meta.dirname, '..');
const RUN = path.join(SKILL, '.run');
const EVIDENCE = path.join(SKILL, 'evidence');
const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEFAULT_PORT = 18443;
const ROOM_RE = /[?&]room=([ABCDEFGHJKLMNPQRSTUVWXYZ]{4})(?:&|$)/;

const stateFile = path.join(RUN, 'state.json');
const browserFile = path.join(RUN, 'browser.json');
const networkFile = path.join(RUN, 'network.jsonl');

function fail(message) {
  const error = new Error(message);
  error.verification = true;
  throw error;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function redact(text) {
  return text.replace(/hostToken=[^&\s"]+/g, 'hostToken=[redacted]');
}

function readable(raw) {
  return raw.replace(/\u001b\[[0-9;]*m/g, '').replace(/[^\n\t\x20-\x7e]/g, '');
}

function run(command, args, timeout = 20000) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          code: error === null ? 0 : typeof error.code === 'number' ? error.code : 1,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
        });
      },
    );
  });
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function commandOf(pid) {
  const result = await run('ps', ['-o', 'command=', '-p', String(pid)]);
  return result.stdout.trim();
}

async function childPids(pid) {
  const result = await run('pgrep', ['-P', String(pid)]);
  if (result.code !== 0) return [];
  return result.stdout
    .split('\n')
    .map((line) => Number(line.trim()))
    .filter((value) => Number.isInteger(value) && value > 1);
}

async function descendantPids(pid) {
  const found = [];
  const pending = await childPids(pid);
  while (pending.length > 0) {
    const next = pending.pop();
    if (next === undefined || found.includes(next)) continue;
    found.push(next);
    pending.push(...(await childPids(next)));
  }
  return found;
}

async function signalTree(pid, signal) {
  const descendants = await descendantPids(pid);
  for (const child of descendants.reverse()) {
    try {
      process.kill(child, signal);
    } catch {
      // The child may already have exited.
    }
  }
  try {
    process.kill(pid, signal);
  } catch {
    // The parent may already have exited.
  }
}

function portNumber() {
  const raw = process.env.VERIFY_PORT;
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail(`VERIFY_PORT must be an integer from 1 to 65535. Got ${raw}.`);
  }
  return port;
}

async function listeners(port) {
  const result = await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']);
  if (result.code !== 0) return [];
  return [...new Set(result.stdout.split('\n').map((line) => Number(line.trim())).filter(Boolean))];
}

async function gitRev() {
  const result = await run('git', ['rev-parse', 'HEAD'], 10000);
  return result.code === 0 ? result.stdout.trim() : 'unknown';
}

function readState() {
  if (!existsSync(stateFile)) fail('No verification server. Run launch first.');
  return readJson(stateFile);
}

function baseUrl(state) {
  return `https://127.0.0.1:${state.port}`;
}

async function curl(url) {
  return run('curl', ['--fail', '--silent', '--show-error', '--max-time', '10', url]);
}

function readCertNames() {
  const cert = path.join(REPO, 'certs', 'dev.pem');
  const key = path.join(REPO, 'certs', 'dev-key.pem');
  if (!existsSync(cert) || !existsSync(key)) {
    return { ok: false, names: [], reason: 'Missing certs/dev.pem or certs/dev-key.pem.' };
  }
  const result = spawnSync('openssl', ['x509', '-in', cert, '-noout', '-ext', 'subjectAltName'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    return { ok: false, names: [], reason: 'openssl could not read certs/dev.pem.' };
  }
  const names = [];
  const text = result.stdout ?? '';
  for (const match of text.matchAll(/DNS:([^,\s]+)/g)) names.push(match[1]);
  for (const match of text.matchAll(/IP Address:([^,\s]+)/g)) names.push(match[1]);
  return { ok: true, names };
}

async function doctorReport() {
  const problems = [];
  const lines = [];
  if (!existsSync(stateFile)) {
    return { ok: false, lines: ['fail no verification server. Run launch first.'] };
  }
  const state = readJson(stateFile);
  const url = baseUrl(state);
  if (!pidAlive(state.pid)) problems.push(`server pid ${state.pid} is not running`);
  const owner = pidAlive(state.pid) ? await commandOf(state.pid) : '';
  if (pidAlive(state.pid) && !owner.includes(path.basename(state.logPath))) {
    problems.push(`pid ${state.pid} is not the verification server`);
  }
  const listening = await listeners(state.port);
  if (listening.length === 0) problems.push(`nothing is listening on ${state.port}`);
  for (const pid of listening) {
    const descendants = pidAlive(state.pid) ? await descendantPids(state.pid) : [];
    if (pid !== state.pid && !descendants.includes(pid)) {
      const command = await commandOf(pid);
      problems.push(`port ${state.port} is owned by pid ${pid} (${command || 'unknown'}), not this launch`);
    }
  }
  const host = await curl(`${url}/api/host`);
  let lanIp = '';
  if (host.code !== 0) {
    problems.push(`GET /api/host failed: ${redact(host.stderr || host.stdout || `exit ${host.code}`).trim()}`);
  } else {
    const body = JSON.parse(host.stdout);
    lanIp = typeof body.lanIp === 'string' ? body.lanIp : '';
    if (body.port !== state.port) problems.push(`/api/host port ${body.port} does not match ${state.port}`);
    lines.push(`apiHost=${JSON.stringify({ lanIp, port: body.port })}`);
  }
  const screen = await curl(`${url}/screen/`);
  if (screen.code !== 0) {
    problems.push(`GET /screen/ failed: ${redact(screen.stderr || screen.stdout || `exit ${screen.code}`).trim()}`);
  } else if (!screen.stdout.includes('<title>Screen</title>')) {
    problems.push('GET /screen/ did not return the Screen document');
  } else {
    lines.push('screenTitle=Screen');
  }
  const san = readCertNames();
  if (!san.ok) problems.push(san.reason);
  else {
    lines.push(`certSan=${san.names.join(',')}`);
    if (!san.names.includes('127.0.0.1') || !san.names.includes('localhost')) {
      problems.push('certs/dev.pem must include 127.0.0.1 and localhost');
    }
    const lanOk = lanIp !== '' && san.names.includes(lanIp);
    lines.push(`lanIpInSan=${lanOk}`);
    if (!lanOk && lanIp !== '') {
      lines.push(
        `caveat lanIp ${lanIp} is not in the cert SAN. A phone that opens the QR will fail TLS. Recreate certs/dev.pem with that address. mkcert -install does not add a SAN.`,
      );
    }
  }
  const nvmrcPath = path.join(REPO, '.nvmrc');
  const nvmrc = existsSync(nvmrcPath) ? readFileSync(nvmrcPath, 'utf8').trim() : '';
  lines.unshift(`node=${process.version} nvmrc=${nvmrc || 'missing'} gitRev=${state.gitRev}`);
  lines.unshift(`baseUrl=${url}`);
  lines.push(
    'caveat mkcert -install trusts this Mac only. It asks for the Mac password. This doctor does not run sudo and does not check a phone.',
  );
  if (problems.length > 0) {
    return { ok: false, lines: [...problems.map((item) => `fail ${item}`), ...lines] };
  }
  return { ok: true, lines: ['ok', ...lines] };
}

async function cmdDoctor() {
  const report = await doctorReport();
  for (const line of report.lines) console.log(line);
  if (!report.ok) fail('doctor failed');
  return report;
}

function logText() {
  const state = readState();
  if (!existsSync(state.logPath)) fail(`Server log is missing: ${state.logPath}`);
  return readable(readFileSync(state.logPath, 'utf8'));
}

function linkFromLog(label) {
  const pad = label.padEnd(8, ' ');
  const hits = logText()
    .split('\n')
    .filter((line) => line.startsWith(`${pad}  https://`));
  if (hits.length === 0) fail(`The server log has no ${label} link yet.`);
  const line = hits[hits.length - 1];
  return line.slice(pad.length).trim();
}

async function cmdUrl(label) {
  const known = ['holistic', 'local', 'team-1', 'team-2'];
  if (!known.includes(label)) fail(`url expects one of ${known.join(', ')}`);
  console.log(linkFromLog(label));
}

async function waitUntilReady(state) {
  const deadline = Date.now() + 90000;
  const needle = `https://127.0.0.1:${state.port}/screen/?room=`;
  while (Date.now() < deadline) {
    if (!pidAlive(state.pid)) {
      const tail = existsSync(state.logPath) ? redact(readable(readFileSync(state.logPath, 'utf8'))).slice(-2000) : '';
      fail(`The server process exited before it was ready.\n${tail}`);
    }
    const log = existsSync(state.logPath) ? readable(readFileSync(state.logPath, 'utf8')) : '';
    const host = await curl(`${baseUrl(state)}/api/host`);
    const screen = await curl(`${baseUrl(state)}/screen/`);
    const httpOk = host.code === 0 && screen.code === 0 && screen.stdout.includes('<title>Screen</title>');
    if (log.includes(needle) && httpOk) return;
    await delay(250);
  }
  const tail = existsSync(state.logPath) ? redact(readable(readFileSync(state.logPath, 'utf8'))).slice(-2000) : '';
  await stopRecordedServer();
  fail(`Timed out waiting for the local screen link and a usable HTTPS response.\n${tail}`);
}

async function cmdLaunch() {
  if (existsSync(stateFile)) {
    const existing = readJson(stateFile);
    if (pidAlive(existing.pid)) {
      console.log('already-running');
      console.log(`baseUrl=${baseUrl(existing)}`);
      console.log(`pid=${existing.pid}`);
      return;
    }
    await stopRecordedBrowser();
    rmSync(RUN, { recursive: true, force: true });
  }
  const port = portNumber();
  const busy = await listeners(port);
  if (busy.length > 0) {
    const command = await commandOf(busy[0]);
    fail(
      `Port ${port} is already in use by pid ${busy[0]} (${command || 'unknown'}). Do not start a second server. Run cleanup if that process is a previous verification launch. Do not point VERIFY_PORT at a living-room server on 8443.`,
    );
  }
  mkdirSync(RUN, { recursive: true });
  const logPath = path.join(RUN, 'server.log');
  writeFileSync(logPath, '');
  const rev = await gitRev();
  const child = spawn(
    'script',
    ['-q', '-F', '-t', '0', logPath, 'corepack', 'pnpm', '--filter', '@server', 'dev'],
    {
      cwd: REPO,
      env: {
        ...process.env,
        PORT: String(port),
        LPC_VERIFY_PORT: String(port),
      },
      detached: true,
      stdio: 'ignore',
    },
  );
  child.unref();
  const state = {
    pid: child.pid,
    port,
    logPath,
    gitRev: rev,
    startedAt: new Date().toISOString(),
  };
  writeJson(stateFile, state);
  try {
    await waitUntilReady(state);
  } catch (error) {
    await stopRecordedServer();
    throw error;
  }
  console.log('launched');
  console.log(`baseUrl=${baseUrl(state)}`);
  console.log(`pid=${state.pid}`);
  console.log(`log=${path.relative(REPO, logPath)}`);
  console.log('ready=local-link-and-https');
}

async function stopRecordedServer() {
  if (!existsSync(stateFile)) return;
  const state = readJson(stateFile);
  const command = pidAlive(state.pid) ? await commandOf(state.pid) : '';
  if (command.includes('script') && command.includes(path.basename(state.logPath))) {
    await signalTree(state.pid, 'SIGTERM');
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && pidAlive(state.pid)) await delay(100);
    if (pidAlive(state.pid)) await signalTree(state.pid, 'SIGKILL');
  }
}

async function stopRecordedBrowser() {
  if (!existsSync(browserFile)) return;
  const browser = readJson(browserFile);
  const command = pidAlive(browser.pid) ? await commandOf(browser.pid) : '';
  if (command.includes(browser.profile)) {
    try {
      process.kill(-browser.pid, 'SIGTERM');
    } catch {
      await signalTree(browser.pid, 'SIGTERM');
    }
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && pidAlive(browser.pid)) await delay(100);
    if (pidAlive(browser.pid)) {
      try {
        process.kill(-browser.pid, 'SIGKILL');
      } catch {
        await signalTree(browser.pid, 'SIGKILL');
      }
    }
  }
  rmSync(browserFile, { force: true });
}

async function cmdCleanup() {
  await stopRecordedBrowser();
  await stopRecordedServer();
  rmSync(RUN, { recursive: true, force: true });
  console.log('cleaned');
  console.log(`evidence=${path.relative(REPO, EVIDENCE)}`);
  console.log('evidence-kept=true');
}

function readBrowser() {
  if (!existsSync(browserFile)) fail('No verification browser. Run browser start first.');
  return readJson(browserFile);
}

async function getJson(port, pathname) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`);
  if (!response.ok) fail(`Chrome DevTools ${pathname} returned ${response.status}`);
  return response.json();
}

function openSocket(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  const listeners = new Set();
  let next = 0;
  ws.addEventListener('message', (event) => {
    const raw = typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8');
    const message = JSON.parse(raw);
    if (message.id !== undefined) {
      const waiter = pending.get(message.id);
      if (waiter === undefined) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message ?? 'cdp error'));
      else waiter.resolve(message.result ?? {});
      return;
    }
    for (const listener of listeners) listener(message);
  });
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', () => reject(new Error('Chrome DevTools websocket failed')), { once: true });
  });
  return {
    ready,
    close() {
      ws.close();
    },
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    send(method, params = {}) {
      const id = ++next;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`cdp timeout ${method}`));
        }, 20000);
        pending.set(id, {
          resolve(value) {
            clearTimeout(timer);
            resolve(value);
          },
          reject(error) {
            clearTimeout(timer);
            reject(error);
          },
        });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

async function withPage(targetId, fn) {
  const browser = readBrowser();
  const list = await getJson(browser.port, '/json/list');
  const page = list.find((item) => item.id === targetId && item.type === 'page');
  if (page === undefined) fail('The selected Chrome tab is gone. Run browser start again.');
  const session = openSocket(page.webSocketDebuggerUrl);
  await session.ready;
  try {
    return await fn(session);
  } finally {
    session.close();
  }
}

async function evaluate(session, expression) {
  const result = await session.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    fail(`Page script failed: ${result.exceptionDetails.text ?? 'exception'}`);
  }
  return result.result?.value;
}

async function cmdBrowserStart() {
  if (existsSync(browserFile)) {
    const existing = readJson(browserFile);
    if (pidAlive(existing.pid)) fail('A verification browser is already running. Run browser stop first.');
  }
  if (!existsSync(CHROME)) fail(`Chrome is missing at ${CHROME}. Set CHROME_PATH.`);
  readState();
  const profile = path.join(RUN, 'chrome-profile');
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  const logPath = path.join(RUN, 'chrome.log');
  const logFd = openSync(logPath, 'w');
  const child = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      '--disable-background-networking',
      '--remote-debugging-port=0',
      '--remote-allow-origins=*',
      `--user-data-dir=${profile}`,
      '--window-size=1280,900',
      '--hide-scrollbars',
      'about:blank',
    ],
    { detached: true, stdio: ['ignore', logFd, logFd] },
  );
  child.unref();
  const deadline = Date.now() + 15000;
  let debugPort = 0;
  while (Date.now() < deadline) {
    if (!pidAlive(child.pid)) {
      const tail = existsSync(logPath) ? readFileSync(logPath, 'utf8').slice(-1500) : '';
      fail(`Chrome exited during start.\n${tail}`);
    }
    const portFile = path.join(profile, 'DevToolsActivePort');
    if (existsSync(portFile)) {
      debugPort = Number(readFileSync(portFile, 'utf8').split('\n')[0]);
      if (Number.isInteger(debugPort) && debugPort > 0) break;
    }
    await delay(100);
  }
  if (!Number.isInteger(debugPort) || debugPort <= 0) fail('Chrome did not open a DevTools port.');
  const list = await getJson(debugPort, '/json/list');
  const page = list.find((item) => item.type === 'page');
  if (page === undefined) fail('Chrome opened without a page tab.');
  writeFileSync(networkFile, '');
  writeJson(browserFile, { pid: child.pid, port: debugPort, targetId: page.id, profile });
  console.log('browser-started');
  console.log(`chromePid=${child.pid}`);
}

async function cmdBrowserStop() {
  await stopRecordedBrowser();
  console.log('browser-stopped');
}

async function pages() {
  const browser = readBrowser();
  const list = await getJson(browser.port, '/json/list');
  return list.filter((item) => item.type === 'page');
}

async function resolveTarget(input) {
  const state = readState();
  if (input === 'screen') return `${baseUrl(state)}/screen/`;
  if (input.startsWith('log:')) return linkFromLog(input.slice(4));
  if (input.startsWith('team:')) return teamTarget(input.slice(5));
  if (input === 'qr') return readQrUrl();
  if (input.startsWith('https://')) return input;
  fail(
    'Unknown open target. Use screen, qr, team:team-1, team:team-2, log:local, log:team-1, log:team-2, log:holistic, or an https URL.',
  );
}

async function teamTarget(view) {
  const allowed = ['holistic', 'team-1', 'team-2'];
  if (!allowed.includes(view)) fail(`team view must be one of ${allowed.join(', ')}.`);
  const browser = readBrowser();
  const list = await pages();
  const page = list.find((item) => item.id === browser.targetId);
  if (page === undefined || !page.url.includes('/screen') || !page.url.includes('room=')) {
    fail('Select the screen tab for the room, then open team:team-1. The log:team-1 link is a different room.');
  }
  const info = await withPage(page.id, (session) =>
    evaluate(
      session,
      `(() => {
        const room = new URL(location.href).searchParams.get('room') ?? '';
        const token = room === '' ? '' : (localStorage.getItem('party-host-' + room) ?? '');
        return { room, token };
      })()`,
    ),
  );
  if (typeof info?.room !== 'string' || info.room === '' || typeof info?.token !== 'string' || info.token === '') {
    fail('The selected screen tab has no host token in localStorage.');
  }
  const state = readState();
  return `${baseUrl(state)}/screen/?room=${encodeURIComponent(info.room)}&view=${encodeURIComponent(view)}&hostToken=${encodeURIComponent(info.token)}`;
}

async function readQrUrl() {
  const browser = readBrowser();
  const list = await pages();
  const screen = list.find((item) => item.url.includes('/screen'));
  if (screen === undefined) fail('No screen tab is open. Open screen before qr.');
  const previous = browser.targetId;
  browser.targetId = screen.id;
  writeJson(browserFile, browser);
  try {
    const qrUrl = await withPage(screen.id, (session) =>
      evaluate(session, `document.querySelector('p.url')?.textContent?.trim() ?? ''`),
    );
    if (typeof qrUrl !== 'string' || !qrUrl.startsWith('https://')) {
      fail('The screen tab has no controller URL yet.');
    }
    return qrUrl;
  } finally {
    browser.targetId = previous;
    writeJson(browserFile, browser);
  }
}

function isScreenEntry(url) {
  const parsed = new URL(url);
  return (parsed.pathname === '/screen' || parsed.pathname === '/screen/') && !parsed.searchParams.has('room');
}

function rememberPost(posts, post) {
  posts.push(post);
  const prior = existsSync(networkFile) ? readFileSync(networkFile, 'utf8') : '';
  const line = `${JSON.stringify(post)}\n`;
  writeFileSync(networkFile, prior === '' ? line : `${prior.replace(/\n?$/, '\n')}${line}`);
}

async function navigate(targetUrl) {
  const browser = readBrowser();
  await withPage(browser.targetId, async (session) => {
    const loads = [];
    const posts = [];
    const seenPosts = new Set();
    const continueFetch = async (requestId) => {
      try {
        await session.send('Fetch.continueResponse', { requestId });
      } catch {
        try {
          await session.send('Fetch.continueRequest', { requestId });
        } catch {
          // The response may already have continued.
        }
      }
    };
    session.on((message) => {
      if (message.method === 'Page.loadEventFired') loads.push(Date.now());
      if (message.method !== 'Fetch.requestPaused') return;
      const paused = message.params;
      const requestId = paused.requestId;
      if (seenPosts.has(requestId)) return;
      seenPosts.add(requestId);
      const method = paused.request?.method ?? '';
      let pathname = '';
      try {
        pathname = new URL(paused.request.url).pathname;
      } catch {
        pathname = '';
      }
      if (method !== 'POST' || pathname !== '/api/rooms') {
        void continueFetch(requestId);
        return;
      }
      void (async () => {
        const post = {
          method: 'POST',
          path: '/api/rooms',
          status: paused.responseStatusCode ?? 0,
          roomId: '',
          tokenStored: false,
        };
        try {
          const body = await session.send('Fetch.getResponseBody', { requestId });
          const text = body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body;
          const json = JSON.parse(text);
          post.roomId = typeof json.roomId === 'string' ? json.roomId : '';
          post.tokenStored = typeof json.hostToken === 'string' && json.hostToken.length > 0;
        } catch (error) {
          post.bodyError = error instanceof Error ? error.message : 'body unavailable';
        }
        rememberPost(posts, post);
        await continueFetch(requestId);
      })();
    });
    await session.send('Page.enable');
    await session.send('Fetch.enable', {
      patterns: [{ urlPattern: '*api/rooms*', requestStage: 'Response' }],
    });
    await session.send('Runtime.enable');
    await session.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const nav = await session.send('Page.navigate', { url: targetUrl });
    if (nav.errorText) fail(`Navigation failed: ${nav.errorText}`);
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const href = await evaluate(session, 'location.href');
      const lastLoad = loads.length === 0 ? 0 : loads[loads.length - 1];
      const settled = loads.length > 0 && Date.now() - lastLoad > 400;
      const waitingForRoom = isScreenEntry(targetUrl) && (typeof href !== 'string' || !href.includes('room='));
      if (settled && !waitingForRoom) break;
      await delay(100);
    }
    const href = await evaluate(session, 'location.href');
    if (isScreenEntry(targetUrl) && (typeof href !== 'string' || !href.includes('room='))) {
      const text = await evaluate(session, 'document.body?.innerText ?? ""');
      fail(`The screen did not create a room. Address is ${href}.\n${String(text).slice(0, 500)}`);
    }
    const bodyDeadline = Date.now() + 2000;
    while (posts.length === 0 && Date.now() < bodyDeadline && isScreenEntry(targetUrl)) await delay(50);
  });
  console.log(`opened ${redact(targetUrl)}`);
}

async function cmdBrowserOpen(input) {
  const target = await resolveTarget(input);
  await navigate(target);
}

async function cmdBrowserTab(action, input) {
  if (action === 'list') {
    const browser = readBrowser();
    const list = await pages();
    list.forEach((page, index) => {
      const mark = page.id === browser.targetId ? '*' : ' ';
      console.log(`${mark} ${index} ${redact(page.url)}`);
    });
    return;
  }
  if (action === 'use') {
    if (input === '') fail('browser tab use expects a URL substring.');
    const list = await pages();
    const hits = list.filter((page) => page.url.includes(input));
    if (hits.length !== 1) {
      const urls = hits.map((page) => redact(page.url)).join('\n');
      fail(`tab use ${input} matched ${hits.length} tabs.\n${urls}`);
    }
    const browser = readBrowser();
    browser.targetId = hits[0].id;
    writeJson(browserFile, browser);
    console.log(`selected ${redact(hits[0].url)}`);
    return;
  }
  if (action === 'select') {
    const index = Number(input);
    const list = await pages();
    const page = list[index];
    if (page === undefined) fail(`No tab at index ${input}.`);
    const browser = readBrowser();
    browser.targetId = page.id;
    writeJson(browserFile, browser);
    console.log(`selected ${index} ${redact(page.url)}`);
    return;
  }
  if (action === 'open') {
    const target = await resolveTarget(input);
    const browser = readBrowser();
    const version = await getJson(browser.port, '/json/version');
    const session = openSocket(version.webSocketDebuggerUrl);
    await session.ready;
    try {
      const created = await session.send('Target.createTarget', { url: 'about:blank' });
      browser.targetId = created.targetId;
      writeJson(browserFile, browser);
    } finally {
      session.close();
    }
    await navigate(target);
    return;
  }
  fail('browser tab expects list, use <substring>, select <index>, or open <target>.');
}

async function cmdBrowserClick(label) {
  const browser = readBrowser();
  const outcome = await withPage(browser.targetId, (session) =>
    evaluate(
      session,
      `(() => {
        const label = ${JSON.stringify(label)};
        const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === label);
        if (button === undefined) return { ok: false, reason: 'missing' };
        if (button.disabled) return { ok: false, reason: 'disabled' };
        button.click();
        return { ok: true };
      })()`,
    ),
  );
  if (!outcome?.ok) fail(`Could not click ${label} (${outcome?.reason ?? 'unknown'}).`);
  console.log(`clicked ${label}`);
}

async function cmdBrowserFill(placeholder, value) {
  const browser = readBrowser();
  const outcome = await withPage(browser.targetId, (session) =>
    evaluate(
      session,
      `(() => {
        const field = document.querySelector(${JSON.stringify(`input[placeholder="${placeholder}"]`)});
        if (field === null) return { ok: false, reason: 'missing' };
        if (field.disabled) return { ok: false, reason: 'disabled' };
        field.focus();
        field.value = ${JSON.stringify(value)};
        field.dispatchEvent(new InputEvent('input', { bubbles: true, data: ${JSON.stringify(value)}, inputType: 'insertText' }));
        return { ok: true, value: field.value };
      })()`,
    ),
  );
  if (!outcome?.ok) fail(`Could not fill ${placeholder} (${outcome?.reason ?? 'unknown'}).`);
  console.log(`filled ${placeholder}`);
}

async function pageFacts() {
  const browser = readBrowser();
  return withPage(browser.targetId, (session) =>
    evaluate(
      session,
      `(() => ({
        title: document.title,
        url: location.href,
        text: document.body?.innerText ?? '',
        buttons: [...document.querySelectorAll('button')].map((button) => ({
          text: button.textContent.trim(),
          disabled: button.disabled,
          pressed: button.getAttribute('data-pressed'),
        })),
        qrUrl: document.querySelector('p.url')?.textContent?.trim() ?? '',
        qrCanvas: document.querySelector('canvas.qr') !== null,
        headings: [...document.querySelectorAll('h1,h2')].map((node) => node.textContent.trim()),
        hostKeys: Object.keys(localStorage).filter((key) => key.startsWith('party-host-')),
      }))()`,
    ),
  );
}

async function cmdBrowserFacts(outPath) {
  const facts = await pageFacts();
  const json = JSON.stringify(facts, null, 2);
  if (outPath !== undefined) {
    const absolute = path.resolve(REPO, outPath);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, `${json}\n`);
  }
  console.log(json);
  return facts;
}

async function cmdBrowserText() {
  const facts = await pageFacts();
  console.log(facts.text);
}

async function cmdBrowserWaitText(needle, timeout) {
  const browser = readBrowser();
  const deadline = Date.now() + timeout;
  let latest = '';
  while (Date.now() < deadline) {
    latest = await withPage(browser.targetId, (session) =>
      evaluate(session, 'document.body?.innerText ?? ""'),
    );
    if (typeof latest === 'string' && latest.includes(needle)) {
      console.log(`visible ${needle}`);
      return;
    }
    await delay(200);
  }
  fail(`Timed out waiting for ${JSON.stringify(needle)}.\n${String(latest).slice(0, 800)}`);
}

async function cmdBrowserScreenshot(outPath) {
  const browser = readBrowser();
  const image = await withPage(browser.targetId, async (session) => {
    await session.send('Page.enable');
    return session.send('Page.captureScreenshot', { format: 'png' });
  });
  const absolute = path.resolve(REPO, outPath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, Buffer.from(image.data, 'base64'));
  console.log(`screenshot ${path.relative(REPO, absolute)}`);
}

function roomFromUrl(url) {
  const match = url.match(ROOM_RE);
  return match === null ? '' : match[1];
}

function buttonNamed(facts, label) {
  return facts.buttons.find((button) => button.text === label);
}

function readPosts() {
  if (!existsSync(networkFile)) return [];
  return readFileSync(networkFile, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

async function cmdDriveCreateRoom() {
  const evidenceDir = path.join(EVIDENCE, 'create-room');
  mkdirSync(evidenceDir, { recursive: true });
  const report = await doctorReport();
  writeFileSync(path.join(evidenceDir, 'doctor.txt'), `${report.lines.join('\n')}\n`);
  for (const line of report.lines) console.log(line);
  if (!report.ok) fail('doctor failed');
  await stopRecordedBrowser();
  await cmdBrowserStart();
  try {
    await cmdBrowserOpen('screen');
    await cmdBrowserWaitText('VIEW // HOLISTIC', 20000);
    const facts = await cmdBrowserFacts(path.join(evidenceDir, 'facts.json'));
    writeFileSync(path.join(evidenceDir, 'lobby.txt'), `${facts.text}\n`);
    await cmdBrowserScreenshot(path.join(evidenceDir, 'lobby.png'));
    const room = roomFromUrl(facts.url);
    const start = buttonNamed(facts, 'START');
    const sumo = buttonNamed(facts, 'SUMO DASH');
    const posts = readPosts();
    const problems = [];
    if (facts.title !== 'Screen') problems.push(`title is ${facts.title}`);
    if (!facts.url.includes('view=holistic')) problems.push('url is missing view=holistic');
    if (room === '') problems.push('url is missing a room code');
    if (!facts.text.includes('VIEW // HOLISTIC')) problems.push('badge is missing');
    if (facts.text.includes('HOST // TOKEN MISSING')) problems.push('host token is missing');
    if (sumo === undefined) problems.push('SUMO DASH button is missing');
    if (start === undefined) problems.push('START button is missing');
    if (start?.disabled !== true) problems.push('START is enabled before two players join');
    if (facts.qrCanvas !== true) problems.push('QR canvas is missing');
    if (!facts.qrUrl.includes(`/controller?rev=6&room=${room}`)) problems.push('QR url does not name the room');
    if (!facts.hostKeys.includes(`party-host-${room}`)) problems.push('localStorage is missing the host key');
    if (posts.length !== 1) problems.push(`expected one POST /api/rooms, saw ${posts.length}`);
    if (posts[0]?.status !== 200) problems.push(`POST /api/rooms status ${posts[0]?.status ?? 'missing'}`);
    if (posts[0]?.roomId && posts[0].roomId !== room) problems.push('POST roomId does not match the address');
    if (posts[0]?.tokenStored !== true && !facts.hostKeys.includes(`party-host-${room}`)) {
      problems.push('POST response did not include a host token');
    }
    await cmdBrowserOpen(facts.url);
    await cmdBrowserWaitText(room, 20000);
    const second = await cmdBrowserFacts(path.join(evidenceDir, 'second-facts.json'));
    writeFileSync(path.join(evidenceDir, 'second-lobby.txt'), `${second.text}\n`);
    if (roomFromUrl(second.url) !== room) problems.push('the second open created a different room');
    if (!second.hostKeys.includes(`party-host-${room}`)) problems.push('the host key disappeared');
    if (readPosts().length !== 1) problems.push('the second open posted another room');
    const summary = [
      `feature=create-room`,
      `room=${room}`,
      `url=${redact(facts.url)}`,
      `secondUrl=${redact(second.url)}`,
      `postCount=${readPosts().length}`,
      `postRoom=${posts[0]?.roomId || room}`,
      `tokenStored=${posts[0]?.tokenStored === true}`,
      `startDisabled=${start?.disabled === true}`,
      `qrCanvas=${facts.qrCanvas === true}`,
      problems.length === 0 ? 'result=pass' : `result=fail ${problems.join('; ')}`,
    ];
    writeFileSync(path.join(evidenceDir, 'summary.txt'), `${summary.join('\n')}\n`);
    writeFileSync(path.join(evidenceDir, 'network.json'), `${JSON.stringify(readPosts(), null, 2)}\n`);
    if (problems.length > 0) fail(problems.join('\n'));
    console.log(`evidence ${path.relative(REPO, evidenceDir)}`);
  } finally {
    await stopRecordedBrowser();
  }
}

function help() {
  console.log(`Usage (from the repo root):
  .cursor/skills/verify-local-party-console/scripts/verify.mjs launch
  .cursor/skills/verify-local-party-console/scripts/verify.mjs doctor
  .cursor/skills/verify-local-party-console/scripts/verify.mjs url <holistic|local|team-1|team-2>
  .cursor/skills/verify-local-party-console/scripts/verify.mjs browser start|stop
  .cursor/skills/verify-local-party-console/scripts/verify.mjs browser open <screen|qr|team:team-1|team:team-2|log:local|log:team-1|log:team-2|log:holistic|https://...>
  .cursor/skills/verify-local-party-console/scripts/verify.mjs browser tab list
  .cursor/skills/verify-local-party-console/scripts/verify.mjs browser tab use <url-substring>
  .cursor/skills/verify-local-party-console/scripts/verify.mjs browser tab select <index>
  .cursor/skills/verify-local-party-console/scripts/verify.mjs browser tab open <target>
  .cursor/skills/verify-local-party-console/scripts/verify.mjs browser click --text <label>
  .cursor/skills/verify-local-party-console/scripts/verify.mjs browser fill --placeholder <name> --value <text>
  .cursor/skills/verify-local-party-console/scripts/verify.mjs browser wait-text <text> [--timeout <ms>]
  .cursor/skills/verify-local-party-console/scripts/verify.mjs browser text
  .cursor/skills/verify-local-party-console/scripts/verify.mjs browser facts [--out <path>]
  .cursor/skills/verify-local-party-console/scripts/verify.mjs browser screenshot <path>
  .cursor/skills/verify-local-party-console/scripts/verify.mjs drive create-room
  .cursor/skills/verify-local-party-console/scripts/verify.mjs cleanup

VERIFY_PORT defaults to ${DEFAULT_PORT}. Evidence stays in .cursor/skills/verify-local-party-console/evidence/.`);
}

function flag(args, name) {
  const index = args.indexOf(name);
  if (index < 0 || args[index + 1] === undefined) fail(`Missing value for ${name}.`);
  return args[index + 1];
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === undefined || command === 'help' || command === '--help') {
    help();
    return;
  }
  if (command === 'launch') return cmdLaunch();
  if (command === 'doctor') return cmdDoctor();
  if (command === 'cleanup') return cmdCleanup();
  if (command === 'url') return cmdUrl(args[0] ?? '');
  if (command === 'drive') {
    if (args[0] !== 'create-room') fail('drive expects create-room.');
    return cmdDriveCreateRoom();
  }
  if (command === 'browser') {
    const sub = args[0];
    if (sub === 'start') return cmdBrowserStart();
    if (sub === 'stop') return cmdBrowserStop();
    if (sub === 'open') return cmdBrowserOpen(args[1] ?? '');
    if (sub === 'tab') return cmdBrowserTab(args[1] ?? '', args[2] ?? '');
    if (sub === 'click') return cmdBrowserClick(flag(args, '--text'));
    if (sub === 'fill') return cmdBrowserFill(flag(args, '--placeholder'), flag(args, '--value'));
    if (sub === 'wait-text') {
      const timeoutFlag = args.indexOf('--timeout');
      const timeout = timeoutFlag >= 0 ? Number(args[timeoutFlag + 1]) : 20000;
      return cmdBrowserWaitText(args[1] ?? '', timeout);
    }
    if (sub === 'text') return cmdBrowserText();
    if (sub === 'facts') {
      const outFlag = args.indexOf('--out');
      return cmdBrowserFacts(outFlag >= 0 ? args[outFlag + 1] : undefined);
    }
    if (sub === 'screenshot') return cmdBrowserScreenshot(args[1] ?? '');
  }
  help();
  fail(`Unknown command ${command ?? ''}.`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
