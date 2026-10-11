import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT } from '../../shared/constants.ts';
import { startServer } from './server.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = Number(process.env.PORT) || DEFAULT_PORT;

const server = await startServer({ port, staticDir: path.join(root, 'dist') });
console.log(`mechakov server listening on http://localhost:${server.port}`);
