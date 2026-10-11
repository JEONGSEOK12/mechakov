import { ITEMS } from '../../shared/items.ts';
import { canAfford, level, nextCost, UPGRADES, UPGRADE_IDS, type Profile } from '../../shared/upgrades.ts';

const $ = (id: string) => document.getElementById(id)!;

/**
 * The between-raids screen: what's in the stash and what it can buy. In solo it
 * is also the lobby, held open between raids with a button to start the next.
 */
export class Hideout {
  open = false;
  /** Shown as the lobby: can't be closed, only left by starting a raid. */
  lobby = false;
  onUpgrade: (id: string) => void = () => {};
  onStart: () => void = () => {};

  constructor() {
    $('hideout-close').addEventListener('click', () => this.toggle(false));
    $('raid-start').addEventListener('click', () => this.onStart());
    $('upgrades').addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).dataset.upgrade;
      if (id) this.onUpgrade(id);
    });
  }

  toggle(open = !this.open) {
    if (this.lobby) open = true;
    this.open = open;
    $('hideout').classList.toggle('hidden', !open);
    if (open) document.exitPointerLock();
  }

  /** Switch between the lobby and the plain hideout panel. */
  setLobby(lobby: boolean, lastRaid = '') {
    if (lobby === this.lobby) return;
    this.lobby = lobby;
    $('hideout-title').textContent = lobby ? '대기실' : '은신처';
    $('hideout-close').classList.toggle('hidden', lobby);
    $('lobby-bar').classList.toggle('hidden', !lobby);
    $('last-raid').textContent = lastRaid;
    this.toggle(lobby);
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
