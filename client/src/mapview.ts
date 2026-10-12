import { THEME_NAMES, type GameMap, type Station, type Zone } from '../../shared/map.ts';

const SIZE = 900;
const STATION_NAMES: Record<Station, string> = { stash: '보관함', bench: '작업대', door: '레이드 출발', range: '연습실', leave: '은신처로' };

/**
 * The full map, opened with M: walls, props, named areas and exits drawn from
 * above, with an arrow for where you are and which way you face. Only your own
 * position is shown, so it gives nobody away.
 */
export class MapView {
  open = false;
  private el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private base = document.createElement('canvas');
  private title: HTMLDivElement;
  private map: GameMap | null = null;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'mapview';
    this.el.className = 'hidden';
    this.title = document.createElement('div');
    this.title.className = 'mapview-title';
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = SIZE;
    this.base.width = this.base.height = SIZE;
    const legend = document.createElement('div');
    legend.className = 'mapview-legend';
    legend.innerHTML = '<span class="k-me">▲ 나</span><span class="k-exit">■ 탈출구</span><span class="k-wall">■ 벽·선반</span><span class="k-prop">■ 사물</span><span>M 닫기</span>';
    this.el.append(this.title, this.canvas, legend);
    parent.appendChild(this.el);
  }

  toggle(open = !this.open) {
    this.open = open;
    this.el.classList.toggle('hidden', !open);
  }

  /** Draws everything that doesn't move once per map. */
  setMap(map: GameMap) {
    this.map = map;
    this.title.textContent = `${THEME_NAMES[map.theme]} 전체 지도`;
    const g = this.base.getContext('2d')!;
    const s = SIZE / (map.half * 2);
    const X = (x: number) => (x + map.half) * s;
    const Z = (z: number) => (z + map.half) * s;
    g.fillStyle = '#20242a';
    g.fillRect(0, 0, SIZE, SIZE);

    // Named areas: a faint tint for rooms, so the layout reads at a glance.
    const area = (z: { min: [number, number]; max: [number, number] }) => (z.max[0] - z.min[0]) * (z.max[1] - z.min[1]);
    const zones = map.zones.filter((z) => area(z) < (map.half * 2) ** 2 * 0.5);
    zones.forEach((z, i) => {
      g.fillStyle = i % 2 ? 'rgba(120, 160, 200, 0.07)' : 'rgba(200, 170, 120, 0.07)';
      g.fillRect(X(z.min[0]), Z(z.min[1]), (z.max[0] - z.min[0]) * s, (z.max[1] - z.min[1]) * s);
    });

    // Roads, with a dashed middle line, and building floors.
    for (const r of map.roads) {
      g.fillStyle = '#121418';
      g.fillRect(X(r.min[0]), Z(r.min[1]), (r.max[0] - r.min[0]) * s, (r.max[1] - r.min[1]) * s);
    }
    g.strokeStyle = 'rgba(232, 211, 106, 0.6)';
    g.lineWidth = 1;
    g.setLineDash([6, 6]);
    for (const r of map.roads) {
      g.beginPath();
      if (r.max[0] - r.min[0] > r.max[1] - r.min[1]) {
        const z = Z((r.min[1] + r.max[1]) / 2);
        g.moveTo(X(r.min[0]), z);
        g.lineTo(X(r.max[0]), z);
      } else {
        const x = X((r.min[0] + r.max[0]) / 2);
        g.moveTo(x, Z(r.min[1]));
        g.lineTo(x, Z(r.max[1]));
      }
      g.stroke();
    }
    g.setLineDash([]);
    for (const bld of map.buildings) {
      g.fillStyle = '#2d333b';
      g.fillRect(X(bld.min[0]), Z(bld.min[1]), (bld.max[0] - bld.min[0]) * s, (bld.max[1] - bld.min[1]) * s);
    }

    for (const b of map.propBoxes) {
      if (b.min[1] > 0.01) continue;
      g.fillStyle = b.max[1] > 1.5 ? '#6f6656' : '#4c5058';
      g.fillRect(X(b.min[0]), Z(b.min[2]), Math.max(1.5, (b.max[0] - b.min[0]) * s), Math.max(1.5, (b.max[2] - b.min[2]) * s));
    }
    const edges: typeof map.walls = [];
    for (const w of map.walls) {
      if (w.min[1] > 0) continue;
      const outer = w.max[1] >= map.wallHeight;
      // The blocks that make the edge wander are out of bounds, drawn dark with a bright rim.
      const h = map.half - 0.01;
      const edge = Math.min(w.max[0] - w.min[0], w.max[2] - w.min[2]) > 0.6 && (w.min[0] <= -h || w.max[0] >= h || w.min[2] <= -h || w.max[2] >= h);
      if (edge) {
        edges.push(w);
        continue;
      }
      g.fillStyle = outer ? '#c9ced4' : w.max[1] > 1.5 ? '#9aa3ad' : '#6a737d';
      g.fillRect(X(w.min[0]), Z(w.min[2]), Math.max(2, (w.max[0] - w.min[0]) * s), Math.max(2, (w.max[2] - w.min[2]) * s));
    }
    for (const [color, grow] of [['#c9ced4', 2], ['#101215', 0]] as const) {
      g.fillStyle = color;
      for (const w of edges) g.fillRect(X(w.min[0]) - grow, Z(w.min[2]) - grow, (w.max[0] - w.min[0]) * s + grow * 2, (w.max[2] - w.min[2]) * s + grow * 2);
    }
    for (const e of map.exits) {
      g.fillStyle = 'rgba(61, 220, 132, 0.85)';
      g.fillRect(X(e.min[0]), Z(e.min[2]), (e.max[0] - e.min[0]) * s, (e.max[2] - e.min[2]) * s);
    }

    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `600 ${map.half > 20 ? 15 : 20}px system-ui, sans-serif`;
    const label = (text: string, x: number, y: number, color: string) => {
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(0, 0, 0, 0.8)';
      g.strokeText(text, x, y);
      g.fillStyle = color;
      g.fillText(text, x, y);
    };
    // A building with rooms inside gets its name above its north wall, so it doesn't sit on the room names.
    const isBuilding = (z: Zone) => map.buildings.some((b) => b.min[0] === z.min[0] && b.min[1] === z.min[1] && b.max[0] === z.max[0] && b.max[1] === z.max[1]);
    const inside = (z: Zone, o: Zone) => o !== z && o.min[0] >= z.min[0] && o.max[0] <= z.max[0] && o.min[1] >= z.min[1] && o.max[1] <= z.max[1];
    for (const z of zones) {
      const cx = X((z.min[0] + z.max[0]) / 2);
      if (isBuilding(z) && zones.some((o) => inside(z, o))) label(z.name, cx, Z(z.min[1]) - 10, '#ffffff');
      else label(z.name, cx, Z((z.min[1] + z.max[1]) / 2), '#e8dcc0');
    }
    for (const e of map.exits) {
      const cx = X((e.min[0] + e.max[0]) / 2);
      const cz = Z((e.min[2] + e.max[2]) / 2);
      label(map.stations ? '' : '탈출', Math.min(SIZE - 30, Math.max(30, cx)), Math.min(SIZE - 14, Math.max(14, cz)), '#7dffb4');
    }
    if (map.stations) {
      for (const [st, pos] of Object.entries(map.stations) as [Station, number[]][]) label(STATION_NAMES[st], X(pos[0]), Z(pos[2]), '#ffd479');
    }
  }

  /** Redraws the arrow; call every frame while open. */
  draw(x: number, z: number, yaw: number) {
    if (!this.open || !this.map) return;
    const g = this.canvas.getContext('2d')!;
    g.drawImage(this.base, 0, 0);
    const s = SIZE / (this.map.half * 2);
    const px = (x + this.map.half) * s;
    const pz = (z + this.map.half) * s;
    g.save();
    g.translate(px, pz);
    // Facing -z (up on the map) at yaw 0, turning left as yaw grows.
    g.rotate(-yaw);
    g.beginPath();
    g.moveTo(0, -14);
    g.lineTo(9, 10);
    g.lineTo(0, 5);
    g.lineTo(-9, 10);
    g.closePath();
    g.fillStyle = '#ffd23f';
    g.strokeStyle = '#000';
    g.lineWidth = 2;
    g.fill();
    g.stroke();
    g.restore();
  }
}
