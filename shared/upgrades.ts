import { characterOf } from './characters.ts';
import { PROPS } from './props.ts';

export type Cost = Record<string, number>;

export interface UpgradeDef {
  name: string;
  /** What each level gives, index 0 being the base level. */
  effects: string[];
  /** costs[i] buys level i + 1. */
  costs: Cost[];
}

export const UPGRADES: Record<string, UpgradeDef> = {
  bag: {
    name: '가방',
    effects: ['3칸', '5칸', '8칸', '12칸'],
    costs: [{ scrap: 2, wires: 1 }, { scrap: 3, bolts: 3, wires: 2 }, { circuit: 2, fuel: 1, bolts: 4 }],
  },
  shoes: {
    name: '운동화',
    effects: ['기본 속도', '속도 +5%', '속도 +10%', '속도 +15%'],
    costs: [{ scrap: 2, bolts: 2 }, { wires: 3, battery: 1 }, { fuel: 1, circuit: 1, battery: 2 }],
  },
  armor: {
    name: '보강 장갑',
    effects: ['체력 100', '체력 110', '체력 120', '체력 140'],
    costs: [{ scrap: 3 }, { bolts: 3, battery: 1 }, { circuit: 2, gpu: 1 }],
  },
  catalog: {
    name: '변신 도감',
    effects: ['작은 사물', '+ 중간 사물 (상자, 드럼통, 책상, 프린터 등)', '+ 큰 사물 (사물함, 책장, 소파, 발전기 등)'],
    costs: [{ wires: 2, battery: 1 }, { circuit: 2, watch: 1 }],
  },
  scope: {
    name: '조준경 (저격수)',
    effects: ['헛발질 피해 5', '헛발질 피해 3', '헛발질 피해 1'],
    costs: [{ bolts: 2, wires: 1 }, { circuit: 1, battery: 2 }],
  },
};

export const UPGRADE_IDS = Object.keys(UPGRADES);

export interface Profile {
  name: string;
  stash: Record<string, number>;
  upgrades: Record<string, number>;
  /** Picked in the hideout or lobby; see `CHARACTERS`. */
  character?: string;
}

export const level = (p: Profile, id: string) => p.upgrades[id] ?? 0;

export const bagCapacity = (p: Profile) => [3, 5, 8, 12][level(p, 'bag')];
export const speedMult = (p: Profile) => [1, 1.05, 1.1, 1.15][level(p, 'shoes')] * characterOf(p.character).speed;
export const maxHp = (p: Profile) => Math.round([100, 110, 120, 140][level(p, 'armor')] * characterOf(p.character).hp);
export const missPenalty = (p: Profile) => [5, 3, 1][level(p, 'scope')];
export const canDisguiseAs = (p: Profile, type: string) => PROPS[type].tier <= level(p, 'catalog');

export function canAfford(p: Profile, cost: Cost) {
  return Object.entries(cost).every(([item, n]) => (p.stash[item] ?? 0) >= n);
}

/** The cost of the next level, or null when maxed out. */
export function nextCost(p: Profile, id: string): Cost | null {
  return UPGRADES[id].costs[level(p, id)] ?? null;
}
