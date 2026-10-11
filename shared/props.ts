import type { Vec3 } from './types.ts';

export type PropShape = 'box' | 'cylinder' | 'cone';

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
}

export const PROPS: Record<string, PropDef> = {
  crate: { name: '나무 상자', shape: 'box', size: [1, 1, 1], color: 0x9c6b3c, weight: 5, tier: 1 },
  smallBox: { name: '종이 상자', shape: 'box', size: [0.6, 0.45, 0.5], color: 0xc8a26b, weight: 5, tier: 0 },
  barrel: { name: '드럼통', shape: 'cylinder', size: [0.8, 1.1, 0.8], color: 0x3d6e8f, weight: 4, tier: 1 },
  cone: { name: '라바콘', shape: 'cone', size: [0.45, 0.75, 0.45], color: 0xe8692a, weight: 2, tier: 0 },
  locker: { name: '사물함', shape: 'box', size: [0.7, 1.9, 0.5], color: 0x6b7a80, weight: 2, tier: 2 },
  tire: { name: '타이어', shape: 'cylinder', size: [0.85, 0.35, 0.85], color: 0x2a2a2a, weight: 2, tier: 0 },
  bucket: { name: '양동이', shape: 'cylinder', size: [0.4, 0.45, 0.4], color: 0xb8c4c8, weight: 3, tier: 0 },
  pallet: { name: '팔레트', shape: 'box', size: [1.2, 0.15, 1], color: 0xb08850, weight: 2, tier: 0 },
};

export const PROP_TYPES = Object.keys(PROPS);
