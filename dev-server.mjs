import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

const root = resolve('dist');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const path = resolve(root, '.' + pathname);
  if (!path.startsWith(root + '\\') && path !== root) { response.writeHead(403).end(); return; }
  try {
    const data = await readFile(path);
    response.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' }).end(data);
  } catch { response.writeHead(404).end(); }
}).listen(4173, '127.0.0.1', () => console.log('Local: http://localhost:4173'));
