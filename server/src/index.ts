import { existsSync, readFileSync } from 'node:fs';
import type { Server as HttpsServer } from 'node:https';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { attachRelay } from './relay.ts';
import { createRoom, createRoomStore, type RoomStore } from './rooms.ts';
import { screenLinkLines } from './screen-links.ts';

const CERT_PATH = path.resolve(import.meta.dirname, '../../certs/dev.pem');
const KEY_PATH = path.resolve(import.meta.dirname, '../../certs/dev-key.pem');

export interface RelayHandle {
  port: number;
  close(): Promise<void>;
}

export function isRfc1918(address: string): boolean {
  const parts = address.split('.');
  if (parts.length !== 4) return false;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const a = numbers[0];
  const b = numbers[1];
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
  return false;
}

export function firstNonInternalIpv4(): string {
  const nets = networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const entry of list ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return '127.0.0.1';
}

function listenPort(): number {
  const raw = process.env.PORT;
  if (raw === undefined || raw === '') return 8443;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) return 8443;
  return port;
}

function addRoutes(app: FastifyInstance, store: RoomStore): void {
  app.post('/api/rooms', async () => createRoom(store));
  app.get('/api/host', async (request) => {
    const lanIp = isRfc1918(request.hostname) ? request.hostname : firstNonInternalIpv4();
    const address = app.server.address();
    const port = typeof address === 'object' && address !== null ? address.port : listenPort();
    return { lanIp, port };
  });
}

function buildApp(store: RoomStore): FastifyInstance {
  const app = Fastify({ logger: false });
  addRoutes(app, store);
  return app;
}

function buildHttpsApp(store: RoomStore): FastifyInstance<HttpsServer> {
  const app = Fastify({
    logger: false,
    https: {
      key: readFileSync(KEY_PATH),
      cert: readFileSync(CERT_PATH),
    },
  });
  addRoutes(app, store);
  return app;
}

export async function startRelay(): Promise<RelayHandle> {
  const store = createRoomStore();
  const app = buildApp(store);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const relay = attachRelay(app.server, store);
  const address = app.server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('relay did not bind a TCP port');
  }
  return {
    port: address.port,
    async close() {
      relay.close();
      await app.close();
    },
  };
}

export async function start(): Promise<void> {
  if (!existsSync(CERT_PATH) || !existsSync(KEY_PATH)) {
    throw new Error('Refusing to start. Missing certs/dev.pem or certs/dev-key.pem.');
  }
  const store = createRoomStore();
  const app = buildHttpsApp(store);
  const { mountDevFrontends } = await import('./dev-frontends.ts');
  await mountDevFrontends(app);
  await app.listen({ port: listenPort(), host: '0.0.0.0' });
  attachRelay(app.server, store);
  const address = app.server.address();
  const port = typeof address === 'object' && address !== null ? address.port : listenPort();
  const created = createRoom(store);
  for (const line of screenLinkLines(firstNonInternalIpv4(), port, created.roomId, created.hostToken)) {
    console.log(line);
  }
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (isMainModule()) {
  start().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'server failed to start';
    console.error(message);
    process.exit(1);
  });
}
