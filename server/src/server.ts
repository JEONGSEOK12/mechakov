import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { DEFAULT_TIMINGS, type Timings } from '../../shared/constants.ts';
import { THEMES } from '../../shared/map.ts';
import type { ClientMsg } from '../../shared/protocol.ts';
import { ProfileStore } from './profiles.ts';
import { cleanName, Room, type Player } from './room.ts';

export interface ServerOptions {
  port: number;
  /** Built client to serve (production). */
  staticDir?: string;
  timings?: Timings;
  seed?: number;
  /** JSON file for player profiles; in memory when omitted. */
  profilesFile?: string;
}

const MAX_CONNECTIONS_PER_IP = 6;
const MSG_PER_SECOND = 60;
const MSG_BURST = 120;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

function serveStatic(dir: string, req: http.IncomingMessage, res: http.ServerResponse) {
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = path.normalize(path.join(dir, urlPath));
  if (!file.startsWith(dir)) {
    res.writeHead(403).end();
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dir, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  });
}

export function startServer(opts: ServerOptions) {
  const rooms = new Map<string, Room>();
  const store = new ProfileStore(opts.profilesFile);
  /** Tokens currently connected, so one profile can't play twice at once. */
  const online = new Set<string>();
  const staticDir = opts.staticDir && fs.existsSync(opts.staticDir) ? path.resolve(opts.staticDir) : null;

  const httpServer = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
      return;
    }
    if (req.url === '/rooms') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const list = [...rooms.values()].map((r) => ({ name: r.name, players: r.humans.length, phase: r.phase }));
      res.end(JSON.stringify({ online: list.reduce((n, r) => n + r.players, 0), rooms: list }));
      return;
    }
    if (staticDir) serveStatic(staticDir, req, res);
    else res.writeHead(200).end('mechakov server. Run the client with `npm run dev`.');
  });

  /** Quick play: the busiest open quick room still between rounds, then any open one, else a new one. */
  let quickCount = 0;
  const quickMatch = () => {
    const open = [...rooms.values()].filter((r) => r.name.startsWith('quick-') && !r.full);
    const waiting = (r: Room) => r.phase === 'lobby' || r.phase === 'countdown';
    open.sort((a, b) => Number(waiting(b)) - Number(waiting(a)) || b.humans.length - a.humans.length);
    return open[0]?.name ?? `quick-${++quickCount}`;
  };

  const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 4096 });
  const perIp = new Map<string, number>();
  wss.on('connection', (ws, req) => {
    // Behind a proxy the real address is in a header; Fly.io sets Fly-Client-IP.
    const forwarded = req.headers['fly-client-ip'] ?? req.headers['x-forwarded-for'];
    const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0].trim() || req.socket.remoteAddress || '?';
    if ((perIp.get(ip) ?? 0) >= MAX_CONNECTIONS_PER_IP) {
      ws.close(1008, 'too many connections');
      return;
    }
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    // Oversized or malformed frames surface here; without a handler they would crash the server.
    ws.on('error', () => ws.terminate());
    ws.on('close', () => {
      const n = (perIp.get(ip) ?? 1) - 1;
      if (n <= 0) perIp.delete(ip);
      else perIp.set(ip, n);
    });

    // Clients send about 30 inputs a second; allow bursts, drop the rest, and
    // disconnect anything flooding far beyond that.
    let budget = MSG_BURST;
    let dropped = 0;
    const refill = setInterval(() => {
      budget = Math.min(MSG_BURST, budget + MSG_PER_SECOND);
      if (dropped > MSG_PER_SECOND * 3) ws.close(1008, 'flooding');
      dropped = 0;
    }, 1000);
    ws.on('close', () => clearInterval(refill));

    const url = new URL(req.url ?? '/ws', 'http://localhost');
    const requested = (url.searchParams.get('room') ?? '').trim().slice(0, 32);
    let player: Player | null = null;
    let room: Room | null = null;

    ws.on('message', (raw) => {
      if (budget <= 0) {
        dropped++;
        return;
      }
      budget--;
      let msg: ClientMsg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!player) {
        if (msg.t !== 'join') return;
        const roomName = requested || quickMatch();
        room = rooms.get(roomName) ?? null;
        if (!room) {
          const theme = opts.seed === undefined ? THEMES[Math.floor(Math.random() * THEMES.length)] : 'warehouse';
          room = new Room(roomName, opts.seed ?? Math.floor(Math.random() * 1e9), opts.timings ?? DEFAULT_TIMINGS, store, theme);
          rooms.set(roomName, room);
          room.start();
        }
        if (room.full) room.removeBot();
        if (room.full) {
          ws.send(JSON.stringify({ t: 'error', message: '방이 가득 찼어요.' }));
          ws.close();
          return;
        }
        const { token, profile } = store.get(msg.token, cleanName(msg.name));
        if (online.has(token)) {
          ws.send(JSON.stringify({ t: 'error', message: '이 계정은 이미 다른 창에서 접속 중이에요.' }));
          ws.close();
          return;
        }
        online.add(token);
        player = room.addPlayer({ send: (d) => ws.readyState === ws.OPEN && ws.send(d) }, msg.name, token, profile);
        return;
      }
      room?.handle(player, msg);
    });

    ws.on('close', () => {
      if (!room || !player) return;
      online.delete(player.token);
      room.removePlayer(player.id);
      if (room.humans.length === 0) {
        room.stop();
        rooms.delete(room.name);
      }
    });
  });

  return new Promise<{ port: number; rooms: Map<string, Room>; store: ProfileStore; close: () => Promise<void> }>((resolve) => {
    httpServer.listen(opts.port, () => {
      const addr = httpServer.address();
      resolve({
        port: typeof addr === 'object' && addr ? addr.port : opts.port,
        rooms,
        store,
        close: () =>
          new Promise<void>((done) => {
            for (const r of rooms.values()) r.stop();
            store.flush();
            for (const c of wss.clients) c.terminate();
            wss.close();
            httpServer.close(() => done());
          }),
      });
    });
  });
}
