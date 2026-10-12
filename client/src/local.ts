import { DEFAULT_TIMINGS } from '../../shared/constants.ts';
import type { ClientMsg, ServerMsg } from '../../shared/protocol.ts';
import type { Profile } from '../../shared/upgrades.ts';
import { Room, type Player } from '../../server/src/room.ts';
import type { Connection } from './net.ts';

const PROFILE_KEY = 'mechakov:solo-profile';
const SOLO_BOTS = 3;

function loadProfile(name: string): Profile {
  try {
    const saved = localStorage.getItem(PROFILE_KEY);
    if (saved) return JSON.parse(saved) as Profile;
  } catch {
    // No storage (private window): progress lasts for this visit only.
  }
  return { name, stash: {}, upgrades: {} };
}

/**
 * Solo play with no server: the same game room runs in this tab. Between raids
 * you walk around the hideout map; raids are every player for themselves, you
 * and the bots as props looting and extracting. Progress is kept in this
 * browser.
 */
export class LocalNet implements Connection {
  onMessage: (msg: ServerMsg) => void = () => {};
  onClose: () => void = () => {};
  private room: Room;
  private player: Player | null = null;
  private profile: Profile | null = null;

  constructor() {
    this.room = new Room('solo', Math.floor(Math.random() * 1e9), DEFAULT_TIMINGS, { save: () => this.saveProfile() }, 'hideout');
    this.room.autoStart = false;
    this.room.start();
  }

  opened() {
    return Promise.resolve();
  }

  send(msg: ClientMsg) {
    if (msg.t === 'join') {
      if (this.player) return;
      this.profile = loadProfile(msg.name);
      // Deliver asynchronously, like a network would, so the game is set up before messages arrive.
      const conn = { send: (data: string) => queueMicrotask(() => this.onMessage(JSON.parse(data))) };
      this.player = this.room.addPlayer(conn, msg.name, 'local-solo-player-token', this.profile);
      for (let i = 0; i < SOLO_BOTS; i++) this.room.addBot();
      return;
    }
    if (this.player) this.room.handle(this.player, msg);
  }

  private saveProfile() {
    try {
      if (this.profile) localStorage.setItem(PROFILE_KEY, JSON.stringify(this.profile));
    } catch {
      // Ignore: see loadProfile.
    }
  }
}
