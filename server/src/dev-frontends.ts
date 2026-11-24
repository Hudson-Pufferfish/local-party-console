import { existsSync, readFileSync } from 'node:fs';
import type { Server as HttpServer } from 'node:http';
import path from 'node:path';
import middie from '@fastify/middie';
import type { FastifyInstance } from 'fastify';
import { createServer as createViteServer, type ViteDevServer } from 'vite';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

export async function mountDevFrontends(app: FastifyInstance): Promise<void> {
  await app.register(middie);
  const parent = httpServer(app);
  const screenRoot = path.join(REPO_ROOT, 'screen');
  const controllerRoot = path.join(REPO_ROOT, 'controller');
  const screenVite = await createViteServer({
    configFile: path.join(screenRoot, 'vite.config.ts'),
    root: screenRoot,
    appType: 'custom',
    server: {
      middlewareMode: { server: parent },
      allowedHosts: true,
      fs: { allow: [REPO_ROOT] },
      ws: { server: parent },
    },
  });
  const controllerConfig = path.join(controllerRoot, 'vite.config.ts');
  const controllerVite = await createViteServer({
    configFile: existsSync(controllerConfig) ? controllerConfig : false,
    root: controllerRoot,
    base: '/controller/',
    appType: 'custom',
    server: {
      middlewareMode: { server: parent },
      allowedHosts: true,
      fs: { allow: [REPO_ROOT] },
      ws: { server: parent },
    },
  });
  app.use(screenVite.middlewares);
  app.use(controllerVite.middlewares);
  serveHtml(app, '/screen', path.join(screenRoot, 'index.html'), screenVite);
  const controllerHtml = path.join(controllerRoot, 'index.html');
  if (existsSync(controllerHtml)) serveHtml(app, '/controller', controllerHtml, controllerVite);
  app.addHook('onClose', async () => {
    await screenVite.close();
    await controllerVite.close();
  });
}

function serveHtml(app: FastifyInstance, base: string, file: string, vite: ViteDevServer): void {
  const handler = async (request: { url: string }, reply: { header: (name: string, value: string) => unknown; type: (value: string) => { send: (body: string) => unknown } }): Promise<void> => {
    const html = await vite.transformIndexHtml(request.url, readFileSync(file, 'utf8'));
    reply.header('Cache-Control', 'no-store');
    reply.type('text/html').send(html);
  };
  app.get(base, handler);
  app.get(`${base}/`, handler);
}

function httpServer(app: FastifyInstance): HttpServer {
  return app.server;
}
