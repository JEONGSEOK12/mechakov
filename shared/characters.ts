/**
 * Rockets fly straight and explode on whatever they touch; grenades arc,
 * bounce, and go off on a direct hit or when their fuse runs out; hitscan
 * guns hit the instant you click.
 */
export interface WeaponDef {
  kind: 'rocket' | 'grenade' | 'hitscan';
  damage: number;
  /** Seconds between shots. */
  cooldown: number;
  /** Projectiles: shots before reloading (0 for no limit). */
  clip: number;
  /** Seconds after the last shot until the whole clip is full again. */
  reload: number;
  /** Projectiles: push at the blast centre, in m/s. */
  knockback: number;
  /** Projectiles: launch speed, in m/s. */
  speed: number;
  /** Hitscan: how far it reaches, in metres. */
  range: number;
  /** Hitscan: keeps firing while the button is held. */
  auto: boolean;
  /** Hitscan: shooting a map prop hurts you (the scope upgrade softens it). */
  decoyPenalty: boolean;
}

/**
 * How a character hides:
 * - `prop`: E turns you into a nearby map prop.
 * - `invisible`: stand still for `INVISIBLE_AFTER` seconds and you vanish for
 *   everyone else until you move or attack.
 * - `decoy`: E leaves a copy of you standing where you are, which looks and
 *   moves like a player to everyone else and pops at the first hit.
 */
export type DisguiseKind = 'prop' | 'invisible' | 'decoy';

/**
 * The right-click skill. `leap`: hold to charge for up to `chargeTime`
 * seconds, let go to throw yourself where you look (up and down too) in an arc like a grenade, farther and
 * higher the longer you held. The first player you hit before landing takes
 * `damage` and is thrown.
 */
export interface SkillDef {
  kind: 'leap';
  name: string;
  /** Seconds for one use to come back; uses come back one after another. */
  cooldown: number;
  /** Uses you can save up. */
  stacks: number;
  chargeTime: number;
  /** Launch speed along where you look, and extra upward speed, at no charge and full charge, in m/s. */
  speed: [number, number];
  lift: [number, number];
  damage: number;
  knockback: number;
}

export interface CharacterDef {
  name: string;
  desc: string;
  /** Multiplies max health. */
  hp: number;
  /** Multiplies movement speed. */
  speed: number;
  disguise: DisguiseKind;
  weapon: WeaponDef;
  skill: SkillDef | null;
}

/** Seconds of standing still before an `invisible` character vanishes. */
export const INVISIBLE_AFTER = 2;
/** Seconds between decoys. */
export const DECOY_COOLDOWN = 5;

const weapon = (w: Partial<WeaponDef> & Pick<WeaponDef, 'kind' | 'damage' | 'cooldown'>): WeaponDef =>
  ({ knockback: 0, speed: 0, range: 0, auto: false, decoyPenalty: false, clip: 0, reload: 0, ...w });

/**
 * Shots left in the clip, given what was left after the last shot: it fills
 * back up all at once `reload` seconds after that shot, so an empty clip
 * means a long wait and a half-empty one tops up if you hold fire as long.
 */
export function ammoAfter(weapon: WeaponDef, left: number, lastShot: number, now: number): number {
  if (!weapon.clip) return Infinity;
  return now - lastShot >= weapon.reload ? weapon.clip : left;
}

/** Everyone plays a prop; the character decides how you hide, move and fight. */
export const CHARACTERS: Record<string, CharacterDef> = {
  rocketeer: {
    name: '로켓병',
    desc: '사물로 변신, 로켓으로 날려 보내고 로켓 점프',
    hp: 1,
    speed: 1,
    disguise: 'prop',
    weapon: weapon({ kind: 'rocket', damage: 18, cooldown: 0.8, clip: 3, reload: 3, knockback: 18, speed: 20 }),
    skill: null,
  },
  grenadier: {
    name: '척탄병',
    desc: '가만히 2초 있으면 투명, 유탄 발사기, 우클릭을 눌렀다 떼면 포물선 돌진',
    hp: 1,
    speed: 1,
    disguise: 'invisible',
    weapon: weapon({ kind: 'grenade', damage: 22, cooldown: 0.4, clip: 3, reload: 3, knockback: 18, speed: 17 }),
    skill: { kind: 'leap', name: '돌진', cooldown: 6, stacks: 2, chargeTime: 1, speed: [8, 18], lift: [4.5, 6], damage: 30, knockback: 16 },
  },
  // A stand-in to try the decoy ability until it gets a character of its own.
  decoyTest: {
    name: '분신 (임시)',
    desc: 'E로 내 분신을 세워 두기, 로켓',
    hp: 1,
    speed: 1,
    disguise: 'decoy',
    weapon: weapon({ kind: 'rocket', damage: 18, cooldown: 0.8, clip: 3, reload: 3, knockback: 18, speed: 20 }),
    skill: null,
  },
};

/**
 * Skill uses are tracked by `fullAt`, the time the last spent use comes back:
 * every use pushes it one cooldown later, so spent uses refill one at a time.
 */
export function skillUses(skill: SkillDef, fullAt: number, now: number): number {
  return skill.stacks - Math.ceil(Math.max(0, fullAt - now) / skill.cooldown - 1e-6);
}

/** `fullAt` after spending a use now. */
export function spendSkill(skill: SkillDef, fullAt: number, now: number): number {
  return Math.max(fullAt, now) + skill.cooldown;
}

/** Seconds until the next use comes back (0 when all are ready). */
export function nextSkillIn(skill: SkillDef, fullAt: number, now: number): number {
  const wait = fullAt - now;
  return wait <= 0 ? 0 : wait - (Math.ceil(wait / skill.cooldown - 1e-6) - 1) * skill.cooldown;
}

export const CHARACTER_IDS = Object.keys(CHARACTERS);
export const DEFAULT_CHARACTER = 'rocketeer';

export const characterOf = (id: string | undefined): CharacterDef => CHARACTERS[id ?? ''] ?? CHARACTERS[DEFAULT_CHARACTER];
