// Companion server for the T3 Code Marketing/Coding toggle. Run: node server/server.mjs
// Serves the toggle script T3's patched page fetches (public/t3-toggle.js), the chat split the toggle filters by,
// and the dashboard shown in Marketing mode (public/index.html: replace it with your own).
// Listens on 127.0.0.1:4780 only; the port is baked into the T3 patch (patches/toggle-loader.cjs).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { t3Split, noteMode, chatMode } from './t3-modes.mjs';

const PORT = 4780;
const PUBLIC = path.join(import.meta.dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
let t3Report = null; // last diagnostics ping from the toggle

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

// Refuse other Host headers, so a web page can't reach this server through DNS rebinding.
const validHost = (req) => new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]).has(req.headers.host);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (!validHost(req)) return send(res, 403, { error: 'unknown host' });
    if (req.method !== 'GET') return send(res, 405, { error: 'GET only' });
    // T3's page reads the chat split (only opaque chat ids, no titles or text), so any origin may read it:
    // T3's custom-scheme page can report its origin as "null".
    if (url.pathname === '/api/t3/split') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      // The toggle sends its current mode; only T3's own page (origin "null" or t3code:) can record a switch.
      // (Same-origin pages and scripts send no Origin header, so they can't.)
      const origin = req.headers.origin || '';
      if (origin === 'null' || origin.startsWith('t3code:')) noteMode(url.searchParams.get('mode'));
      return send(res, 200, t3Split());
    }
    // Diagnostics from the toggle inside T3 (what it found on T3's page), kept in memory for a quick look.
    if (url.pathname === '/api/t3/report') {
      t3Report = { at: new Date().toISOString(), origin: req.headers.origin || null, ...Object.fromEntries(url.searchParams) };
      return send(res, 204, '', 'text/plain');
    }
    if (url.pathname === '/api/t3/last-report') return send(res, 200, t3Report || {});
    // Used by hooks/t3-chat-hook.mjs when a T3 chat starts: is it a Marketing chat?
    if (url.pathname === '/api/t3/chat-mode') return send(res, 200, chatMode({ session: url.searchParams.get('session'), cwd: url.searchParams.get('cwd') }));
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.join(PUBLIC, path.normalize(rel).replace(/^(\.\.[\\/])+/, ''));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'not found', 'text/plain');
    // T3's page (t3code:// origin) fetches this one file to add its toggle.
    if (rel === 't3-toggle.js') res.setHeader('Access-Control-Allow-Origin', '*');
    return send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
  } catch (e) {
    return send(res, 400, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`T3 marketing toggle server on http://127.0.0.1:${PORT}`));
