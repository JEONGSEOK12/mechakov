import { ITEMS } from '../../shared/items.ts';
import { canAfford, level, nextCost, UPGRADES, UPGRADE_IDS, type Profile } from '../../shared/upgrades.ts';

const $ = (id: string) => document.getElementById(id)!;

/** What a panel shows: everything (H), or one hideout station's part of it. */
export type HideoutView = 'all' | 'stash' | 'bench';

const TITLES: Record<HideoutView, string> = { all: '은신처', stash: '보관함', bench: '작업대' };

/** The between-raids screen: what's in the stash and what it can buy. */
export class Hideout {
  open = false;
  onUpgrade: (id: string) => void = () => {};

  constructor() {
    $('hideout-close').addEventListener('click', () => this.toggle(false));
    $('upgrades').addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).dataset.upgrade;
      if (id) this.onUpgrade(id);
    });
  }

  toggle(open = !this.open, view: HideoutView = 'all') {
    this.open = open;
    $('hideout-title').textContent = TITLES[view];
    $('stash-section').classList.toggle('hidden', view === 'bench');
    $('upgrade-section').classList.toggle('hidden', view === 'stash');
    $('hideout').classList.toggle('hidden', !open);
    if (open) document.exitPointerLock();
  }

  render(profile: Profile, canUpgradeNow: boolean) {
    $('hideout-note').textContent = canUpgradeNow ? '' : '레이드 중에는 업그레이드할 수 없어요. 탈출하거나 라운드가 끝나면 가능해요.';

    const stash = Object.entries(profile.stash).filter(([, n]) => n > 0);
    $('stash').innerHTML = stash.length
      ? stash.map(([id, n]) => `<div class="stash-item"><i style="background:#${ITEMS[id].color.toString(16).padStart(6, '0')}"></i>${ITEMS[id].name} ×${n}</div>`).join('')
      : '<div class="stash-item">비어 있어요. 레이드에서 아이템을 챙겨 탈출하세요.</div>';

    $('upgrades').innerHTML = UPGRADE_IDS.map((id) => {
      const def = UPGRADES[id];
      const lv = level(profile, id);
      const cost = nextCost(profile, id);
      const now = def.effects[lv];
      if (!cost) {
        return `<div class="upgrade"><b>${def.name} Lv.${lv}</b><span class="effect">${now} (최대)</span></div>`;
      }
      const costHtml = Object.entries(cost).map(([item, n]) => {
        const have = profile.stash[item] ?? 0;
        return `<span class="${have < n ? 'missing' : ''}">${ITEMS[item].name} ${have}/${n}</span>`;
      }).join('');
      const enabled = canUpgradeNow && canAfford(profile, cost);
      return `<div class="upgrade">
        <b>${def.name} Lv.${lv}</b>
        <span class="effect">${now} → ${def.effects[lv + 1]}</span>
        <span class="cost">${costHtml}</span>
        <button class="buy" data-upgrade="${id}" ${enabled ? '' : 'disabled'}>업그레이드</button>
      </div>`;
    }).join('');
  }
}
