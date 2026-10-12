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
 */
export type DisguiseKind = 'prop' | 'invisible';

/**
 * The right-click skill. `charge`: you fly forward like a projectile for
 * `time` seconds; the first player you hit takes `damage` and is thrown.
 */
export interface SkillDef {
  kind: 'charge';
  name: string;
  cooldown: number;
  time: number;
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
/** How fast a `charge` skill flies, in m/s. */
export const CHARGE_SPEED = 17;

const weapon = (w: Partial<WeaponDef> & Pick<WeaponDef, 'kind' | 'damage' | 'cooldown'>): WeaponDef =>
  ({ knockback: 0, speed: 0, range: 0, auto: false, decoyPenalty: false, ...w });

/** Everyone plays a prop; the character decides how you hide, move and fight. */
export const CHARACTERS: Record<string, CharacterDef> = {
  rocketeer: {
    name: '로켓병',
    desc: '사물로 변신, 로켓으로 날려 보내고 로켓 점프',
    hp: 1,
    speed: 1,
    disguise: 'prop',
    weapon: weapon({ kind: 'rocket', damage: 18, cooldown: 1.4, knockback: 18, speed: 20 }),
    skill: null,
  },
  grenadier: {
    name: '척탄병',
    desc: '가만히 2초 있으면 투명, 유탄 발사기, 우클릭 돌진',
    hp: 1,
    speed: 1,
    disguise: 'invisible',
    weapon: weapon({ kind: 'grenade', damage: 22, cooldown: 0.6, knockback: 10, speed: 17 }),
    skill: { kind: 'charge', name: '돌진', cooldown: 6, time: 0.7, damage: 30, knockback: 16 },
  },
};

export const CHARACTER_IDS = Object.keys(CHARACTERS);
export const DEFAULT_CHARACTER = 'rocketeer';

export const characterOf = (id: string | undefined): CharacterDef => CHARACTERS[id ?? ''] ?? CHARACTERS[DEFAULT_CHARACTER];
