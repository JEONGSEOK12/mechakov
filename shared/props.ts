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
  /** Relative chance of appearing where a map picks freely. */
  weight: number;
  /** Disguise catalog level needed to turn into it. */
  tier: number;
  /** Maps whose areas use it. */
  themes: Theme[];
}

export const PROPS: Record<string, PropDef> = {
  crate: { name: '나무 상자', shape: 'box', size: [1, 1, 1], color: 0x9c6b3c, weight: 5, tier: 1, themes: ['warehouse', 'yard', 'office'] },
  smallBox: { name: '종이 상자', shape: 'box', size: [0.6, 0.45, 0.5], color: 0xc8a26b, weight: 5, tier: 0, themes: ['warehouse', 'office', 'yard'] },
  barrel: { name: '드럼통', shape: 'cylinder', size: [0.8, 1.1, 0.8], color: 0x3d6e8f, weight: 4, tier: 1, themes: ['warehouse', 'yard'] },
  cone: { name: '라바콘', shape: 'cone', size: [0.45, 0.75, 0.45], color: 0xe8692a, weight: 2, tier: 0, themes: ['warehouse', 'yard', 'office'] },
  locker: { name: '사물함', shape: 'box', size: [0.7, 1.9, 0.5], color: 0x6b7a80, weight: 2, tier: 2, themes: ['warehouse', 'office', 'yard'] },
  tire: { name: '타이어', shape: 'cylinder', size: [0.85, 0.35, 0.85], color: 0x2a2a2a, weight: 2, tier: 0, themes: ['warehouse', 'yard'] },
  bucket: { name: '양동이', shape: 'cylinder', size: [0.4, 0.45, 0.4], color: 0xb8c4c8, weight: 3, tier: 0, themes: ['warehouse', 'office', 'yard'] },
  pallet: { name: '팔레트', shape: 'box', size: [1.2, 0.15, 1], color: 0xb08850, weight: 2, tier: 0, themes: ['warehouse', 'yard'] },
  chair: { name: '의자', shape: 'box', size: [0.5, 0.9, 0.5], color: 0x2d3e50, weight: 5, tier: 0, themes: ['office', 'warehouse', 'yard'] },
  plant: { name: '화분', shape: 'cylinder', size: [0.45, 1.1, 0.45], color: 0x3c8d40, weight: 3, tier: 0, themes: ['office', 'warehouse', 'yard'] },
  cooler: { name: '정수기', shape: 'cylinder', size: [0.4, 1.3, 0.4], color: 0x9fd3e6, weight: 1, tier: 1, themes: ['office', 'warehouse', 'yard'] },
  desk: { name: '책상', shape: 'box', size: [1.4, 0.75, 0.7], color: 0xb89a74, weight: 5, tier: 1, themes: ['office', 'warehouse', 'yard'] },
  cabinet: { name: '서류함', shape: 'box', size: [0.5, 1.3, 0.6], color: 0x8b949b, weight: 3, tier: 2, themes: ['office', 'warehouse', 'yard'] },
  toolbox: { name: '공구함', shape: 'box', size: [0.55, 0.3, 0.28], color: 0xc0392b, weight: 3, tier: 0, themes: ['warehouse', 'yard'] },
  gasCan: { name: '기름통', shape: 'box', size: [0.35, 0.45, 0.2], color: 0xd35400, weight: 2, tier: 0, themes: ['warehouse', 'yard'] },
  extinguisher: { name: '소화기', shape: 'cylinder', size: [0.22, 0.6, 0.22], color: 0xe03b2f, weight: 2, tier: 0, themes: ['warehouse', 'office', 'yard'] },
  sack: { name: '포대', shape: 'box', size: [0.65, 0.35, 0.45], color: 0xd8c9a0, weight: 3, tier: 0, themes: ['warehouse', 'yard'] },
  spool: { name: '케이블 드럼', shape: 'cylinder', size: [1, 0.9, 1], color: 0x8a6440, weight: 2, tier: 1, themes: ['warehouse', 'yard'] },
  forkPallet: { name: '짐 실린 팔레트', shape: 'box', size: [1.2, 1.2, 1], color: 0x7d8f69, weight: 2, tier: 2, themes: ['warehouse', 'yard'] },
  trashCan: { name: '휴지통', shape: 'cylinder', size: [0.35, 0.5, 0.35], color: 0x4a5560, weight: 4, tier: 0, themes: ['office', 'warehouse', 'yard'] },
  monitor: { name: '모니터', shape: 'box', size: [0.55, 0.4, 0.18], color: 0x1e2328, weight: 1, tier: 0, themes: ['office', 'warehouse', 'yard'] },
  printer: { name: '프린터', shape: 'box', size: [0.6, 0.4, 0.5], color: 0xd5d8dc, weight: 2, tier: 1, themes: ['office', 'warehouse', 'yard'] },
  floorLamp: { name: '스탠드', shape: 'cylinder', size: [0.3, 1.6, 0.3], color: 0xe8dcc0, weight: 2, tier: 1, themes: ['office', 'warehouse'] },
  copier: { name: '복사기', shape: 'box', size: [0.9, 1.1, 0.7], color: 0xbfc4c9, weight: 1, tier: 2, themes: ['office'] },
  sofa: { name: '소파', shape: 'box', size: [1.8, 0.8, 0.85], color: 0x5b3a6e, weight: 1, tier: 2, themes: ['office', 'warehouse'] },
  bookshelf: { name: '책장', shape: 'box', size: [1, 1.8, 0.35], color: 0x7a5534, weight: 2, tier: 2, themes: ['office', 'warehouse'] },
  gasBottle: { name: '가스통', shape: 'cylinder', size: [0.35, 1.3, 0.35], color: 0x2e8b57, weight: 2, tier: 1, themes: ['yard'] },
  sandbag: { name: '모래주머니', shape: 'box', size: [0.7, 0.3, 0.4], color: 0xa89068, weight: 3, tier: 0, themes: ['yard'] },
  barrier: { name: '바리케이드', shape: 'box', size: [1.2, 0.8, 0.3], color: 0xf39c12, weight: 2, tier: 1, themes: ['yard', 'warehouse', 'office'] },
  block: { name: '콘크리트 블록', shape: 'box', size: [0.8, 0.6, 0.4], color: 0x95a5a6, weight: 3, tier: 0, themes: ['yard'] },
  generator: { name: '발전기', shape: 'box', size: [1.2, 0.9, 0.8], color: 0xf1c40f, weight: 1, tier: 2, themes: ['yard', 'warehouse'] },
  vending: { name: '자판기', shape: 'box', size: [0.9, 1.8, 0.8], color: 0xb8322a, weight: 1, tier: 2, themes: ['office', 'warehouse', 'hideout'] },
  whiteboard: { name: '화이트보드', shape: 'box', size: [1.5, 1.8, 0.5], color: 0xf4f6f6, weight: 1, tier: 2, themes: ['office', 'warehouse'] },
  paintCan: { name: '페인트통', shape: 'cylinder', size: [0.3, 0.35, 0.3], color: 0x2f7fd0, weight: 3, tier: 0, themes: ['warehouse', 'yard', 'office'] },
  wheelbarrow: { name: '외바퀴 수레', shape: 'box', size: [0.7, 0.6, 1.4], color: 0x3a8f4e, weight: 1, tier: 1, themes: ['yard', 'warehouse'] },
  pipes: { name: '파이프 더미', shape: 'box', size: [2.4, 0.65, 0.9], color: 0x7f8c8d, weight: 1, tier: 2, themes: ['yard', 'warehouse'] },
  handTruck: { name: '핸드카트', shape: 'box', size: [0.6, 1.3, 0.6], color: 0xc0392b, weight: 2, tier: 1, themes: ['warehouse', 'yard', 'office'] },
  archiveBox: { name: '문서 상자', shape: 'box', size: [0.4, 0.3, 0.32], color: 0xe2d6bc, weight: 3, tier: 0, themes: ['office', 'warehouse', 'yard'] },
  coffeeTable: { name: '탁자', shape: 'box', size: [1, 0.45, 0.6], color: 0x6e4b2e, weight: 1, tier: 1, themes: ['office', 'warehouse', 'hideout'] },
  microwave: { name: '전자레인지', shape: 'box', size: [0.5, 0.3, 0.38], color: 0xdadfe1, weight: 1, tier: 0, themes: ['office', 'warehouse', 'yard'] },
  serverRack: { name: '서버랙', shape: 'box', size: [0.6, 2, 1], color: 0x1e2226, weight: 1, tier: 2, themes: ['office'] },
  dumpster: { name: '쓰레기 컨테이너', shape: 'box', size: [1.8, 1.3, 1], color: 0x2e6b46, weight: 1, tier: 2, themes: ['yard', 'warehouse', 'office'] },
};

export const PROP_TYPES = Object.keys(PROPS);
