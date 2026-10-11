import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { DEFAULT_TIMINGS, type Timings } from '../../shared/constants.ts';
import type { ClientMsg } from '../../shared/protocol.ts';
import { Room, type Player } from './room.ts';

export interface ServerOptions {
  port: number;
  /** Built client to serve (production). */
  staticDir?: string;
  timings?: Timings;
  seed?: number;
}

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
  const staticDir = opts.staticDir && fs.existsSync(opts.staticDir) ? path.resolve(opts.staticDir) : null;

  const httpServer = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
      return;
    }
    if (staticDir) serveStatic(staticDir, req, res);
    else res.writeHead(200).end('mechakov server. Run the client with `npm run dev`.');
  });

  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '/ws', 'http://localhost');
    const roomName = (url.searchParams.get('room') ?? 'main').slice(0, 32) || 'main';
    let player: Player | null = null;
    let room: Room | null = null;

    ws.on('message', (raw) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!player) {
        if (msg.t !== 'join') return;
        room = rooms.get(roomName) ?? null;
        if (!room) {
          room = new Room(roomName, opts.seed ?? Math.floor(Math.random() * 1e9), opts.timings ?? DEFAULT_TIMINGS);
          rooms.set(roomName, room);
          room.start();
        }
        if (room.full) {
          ws.send(JSON.stringify({ t: 'error', message: '방이 가득 찼어요.' }));
          ws.close();
          return;
        }
        player = room.addPlayer({ send: (d) => ws.readyState === ws.OPEN && ws.send(d) }, msg.name);
        return;
      }
      room?.handle(player, msg);
    });

    ws.on('close', () => {
      if (!room || !player) return;
      room.removePlayer(player.id);
      if (room.players.size === 0) {
        room.stop();
        rooms.delete(room.name);
      }
    });
  });

  return new Promise<{ port: number; rooms: Map<string, Room>; close: () => Promise<void> }>((resolve) => {
    httpServer.listen(opts.port, () => {
      const addr = httpServer.address();
      resolve({
        port: typeof addr === 'object' && addr ? addr.port : opts.port,
        rooms,
        close: () =>
          new Promise<void>((done) => {
            for (const r of rooms.values()) r.stop();
            for (const c of wss.clients) c.terminate();
            wss.close();
            httpServer.close(() => done());
          }),
      });
    });
  });
}
