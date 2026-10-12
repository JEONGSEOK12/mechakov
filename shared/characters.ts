/** Rockets fly slowly and explode; hitscan guns hit the instant you click. */
export interface WeaponDef {
  kind: 'rocket' | 'hitscan';
  damage: number;
  /** Seconds between shots. */
  cooldown: number;
  /** Rockets: push at the blast centre, in m/s. */
  knockback: number;
  /** Hitscan: how far it reaches, in metres. */
  range: number;
  /** Hitscan: keeps firing while the button is held. */
  auto: boolean;
  /** Hitscan: shooting a map prop hurts you (the scope upgrade softens it). */
  decoyPenalty: boolean;
}

export interface CharacterDef {
  name: string;
  desc: string;
  /** Multiplies max health. */
  hp: number;
  /** Multiplies movement speed. */
  speed: number;
  weapon: WeaponDef;
}

const rocket = (damage: number, cooldown: number, knockback: number): WeaponDef =>
  ({ kind: 'rocket', damage, cooldown, knockback, range: 0, auto: false, decoyPenalty: false });
const gun = (damage: number, cooldown: number, range: number, auto: boolean, decoyPenalty: boolean): WeaponDef =>
  ({ kind: 'hitscan', damage, cooldown, knockback: 0, range, auto, decoyPenalty });

/** Everyone plays a prop; the character decides how you move and fight. */
export const CHARACTERS: Record<string, CharacterDef> = {
  rocketeer: { name: '로켓병', desc: '로켓으로 날려 보내고 로켓 점프', hp: 1, speed: 1, weapon: rocket(18, 1.4, 18) },
  scout: { name: '정찰병', desc: '빠르지만 약함, 누르고 있으면 연사', hp: 0.75, speed: 1.3, weapon: gun(4, 0.15, 30, true, false) },
  sniper: { name: '저격수', desc: '멀리서 한 방이 셈, 사물을 쏘면 내가 다침', hp: 0.85, speed: 0.95, weapon: gun(40, 1.5, 90, false, true) },
  heavy: { name: '중장병', desc: '체력이 많고 느림, 더 센 로켓', hp: 1.5, speed: 0.85, weapon: rocket(26, 1.9, 22) },
};

export const CHARACTER_IDS = Object.keys(CHARACTERS);
export const DEFAULT_CHARACTER = 'rocketeer';

export const characterOf = (id: string | undefined): CharacterDef => CHARACTERS[id ?? ''] ?? CHARACTERS[DEFAULT_CHARACTER];
