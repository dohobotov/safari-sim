import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { SimulationCore, type PersistedWorld } from './SimulationCore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// When compiled to dist-server/server/index.js, project root is ../..
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const STATE_FILE = path.join(DATA_DIR, 'world-state.json');

const PORT = Number(process.env.PORT ?? 8080);

function loadPersistedWorld(): PersistedWorld | null {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      return JSON.parse(raw) as PersistedWorld;
    }
  } catch {
    // Ignore corrupted state snapshot and start fresh valley
  }
  return null;
}

function savePersistedWorld(sim: SimulationCore): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(sim.exportSnapshotForDisk()));
  } catch {
    // Non-fatal on read-only filesystems
  }
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const sim = new SimulationCore(loadPersistedWorld());

const server = http.createServer((req, res) => {
  const urlPath = (req.url ?? '/').split('?')[0];

  if (urlPath === '/health') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(
      JSON.stringify({
        ok: true,
        viewers: wss.clients.size,
        day: sim.timeState.day,
        animals: sim.animals.length,
      })
    );
    return;
  }

  // Serve built frontend static bundle if present (allows Railway domain itself to serve UI too!)
  if (fs.existsSync(DIST_DIR)) {
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    const filePath = path.join(DIST_DIR, rel);
    if (filePath.startsWith(DIST_DIR) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
  }

  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end('Safari Live World Server is running.');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  const welcome = JSON.stringify(sim.buildWelcomeMsg(wss.clients.size));
  ws.send(welcome);
});

const TICK_MS = 100;
let lastTick = Date.now();
let saveAccum = 0;

setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.25, (now - lastTick) / 1000);
  lastTick = now;

  sim.step(dt);

  if (wss.clients.size > 0) {
    const payload = JSON.stringify(sim.consumeTickMsg(wss.clients.size));
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  } else {
    // Drain deltas when nobody is connected so they don't accumulate indefinitely
    sim.consumeTickMsg(0);
  }

  saveAccum += dt;
  if (saveAccum >= 30) {
    saveAccum = 0;
    savePersistedWorld(sim);
  }
}, TICK_MS);

process.on('SIGTERM', () => {
  savePersistedWorld(sim);
  process.exit(0);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Safari Live Server listening on port ${PORT}`);
});
