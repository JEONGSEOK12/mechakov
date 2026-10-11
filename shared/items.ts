export interface ItemDef {
  name: string;
  color: number;
  /** Rough worth, shown in the stash. */
  value: number;
  /** Relative chance of spawning in a raid. */
  weight: number;
}

export const ITEMS: Record<string, ItemDef> = {
  scrap: { name: '고철', color: 0x8a8a8a, value: 10, weight: 10 },
  bolts: { name: '볼트', color: 0x9aa4ad, value: 10, weight: 8 },
  wires: { name: '전선 뭉치', color: 0xd4a017, value: 15, weight: 8 },
  battery: { name: '배터리', color: 0x3fbf5f, value: 30, weight: 5 },
  fuel: { name: '연료통', color: 0xc0392b, value: 40, weight: 3 },
  circuit: { name: '회로 기판', color: 0x2f8f5f, value: 45, weight: 4 },
  watch: { name: '금시계', color: 0xf1c40f, value: 100, weight: 1 },
  gpu: { name: '그래픽카드', color: 0x6c5ce7, value: 120, weight: 1 },
};

export const ITEM_TYPES = Object.keys(ITEMS);
