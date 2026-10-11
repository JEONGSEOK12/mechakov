import type { Vec3 } from './types.ts';

export type PropShape = 'box' | 'cylinder' | 'cone';
/** Raid maps, plus the hideout solo players walk around in between raids. */
export type Theme = 'warehouse' | 'office' | 'yard' | 'hideout';

export interface PropDef {
  name: string;
  shape: PropShape;
  /** Width (x), height (y), depth (z) in meters. */
  size: Vec3;
  color: number;
  /** Relative chance of appearing on the map. */
  weight: number;
  /** Disguise catalog level needed to turn into it. */
  tier: number;
  /** Maps it appears on. */
  themes: Theme[];
}

export const PROPS: Record<string, PropDef> = {
  crate: { name: '나무 상자', shape: 'box', size: [1, 1, 1], color: 0x9c6b3c, weight: 5, tier: 1, themes: ['warehouse', 'yard'] },
  smallBox: { name: '종이 상자', shape: 'box', size: [0.6, 0.45, 0.5], color: 0xc8a26b, weight: 5, tier: 0, themes: ['warehouse', 'office', 'yard'] },
  barrel: { name: '드럼통', shape: 'cylinder', size: [0.8, 1.1, 0.8], color: 0x3d6e8f, weight: 4, tier: 1, themes: ['warehouse', 'yard'] },
  cone: { name: '라바콘', shape: 'cone', size: [0.45, 0.75, 0.45], color: 0xe8692a, weight: 2, tier: 0, themes: ['warehouse', 'yard'] },
  locker: { name: '사물함', shape: 'box', size: [0.7, 1.9, 0.5], color: 0x6b7a80, weight: 2, tier: 2, themes: ['warehouse', 'office'] },
  tire: { name: '타이어', shape: 'cylinder', size: [0.85, 0.35, 0.85], color: 0x2a2a2a, weight: 2, tier: 0, themes: ['warehouse', 'yard'] },
  bucket: { name: '양동이', shape: 'cylinder', size: [0.4, 0.45, 0.4], color: 0xb8c4c8, weight: 3, tier: 0, themes: ['warehouse', 'office', 'yard'] },
  pallet: { name: '팔레트', shape: 'box', size: [1.2, 0.15, 1], color: 0xb08850, weight: 2, tier: 0, themes: ['warehouse', 'yard'] },
  chair: { name: '의자', shape: 'box', size: [0.5, 0.9, 0.5], color: 0x2d3e50, weight: 5, tier: 0, themes: ['office'] },
  plant: { name: '화분', shape: 'cylinder', size: [0.45, 1.1, 0.45], color: 0x3c8d40, weight: 3, tier: 0, themes: ['office'] },
  cooler: { name: '정수기', shape: 'cylinder', size: [0.4, 1.3, 0.4], color: 0x9fd3e6, weight: 1, tier: 1, themes: ['office'] },
  desk: { name: '책상', shape: 'box', size: [1.4, 0.75, 0.7], color: 0xb89a74, weight: 5, tier: 1, themes: ['office'] },
  cabinet: { name: '서류함', shape: 'box', size: [0.5, 1.3, 0.6], color: 0x8b949b, weight: 3, tier: 2, themes: ['office'] },
};

export const PROP_TYPES = Object.keys(PROPS);
