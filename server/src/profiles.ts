import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Profile } from '../../shared/upgrades.ts';

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * Player profiles (stash and upgrades), keyed by a random token the browser
 * keeps. Stored as one JSON file; without a file path it stays in memory.
 */
export class ProfileStore {
  private profiles = new Map<string, Profile>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private file?: string) {
    if (file && fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, Profile>;
      for (const [token, p] of Object.entries(data)) this.profiles.set(token, p);
    }
  }

  /** Returns the profile for a token, creating one (and a token) when needed. */
  get(rawToken: unknown, name: string): { token: string; profile: Profile } {
    let token = typeof rawToken === 'string' && TOKEN_RE.test(rawToken) ? rawToken : '';
    if (!token) token = crypto.randomBytes(18).toString('base64url');
    let profile = this.profiles.get(token);
    if (!profile) {
      profile = { name, stash: {}, upgrades: {} };
      this.profiles.set(token, profile);
      this.save();
    }
    profile.name = name;
    return { token, profile };
  }

  /** Writes soon, batching changes that happen close together. */
  save() {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush(), 500);
  }

  flush() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.profiles)));
    fs.renameSync(tmp, this.file);
  }
}
