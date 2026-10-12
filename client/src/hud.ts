import { characterOf } from '../../shared/characters.ts';
import { ITEMS } from '../../shared/items.ts';
import type { Outcome, PlayerSnap, RosterEntry } from '../../shared/protocol.ts';
import type { Phase, Team } from '../../shared/types.ts';

const $ = (id: string) => document.getElementById(id)!;

const PHASE_LABEL: Record<Phase, string> = {
  lobby: '다른 플레이어를 기다리는 중',
  countdown: '곧 시작',
  hide: '숨는 시간',
  hunt: '사냥',
  end: '라운드 종료',
};

function clock(seconds: number) {
  const s = Math.ceil(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class Hud {
  constructor() {
    $('hud').classList.remove('hidden');
  }

  phase(phase: Phase, timeLeft: number, mapName: string, manualStart = false, ffa = true) {
    const label = phase === 'lobby' && manualStart ? '다음 레이드 준비' : ffa && (phase === 'hide' || phase === 'hunt') ? '레이드' : PHASE_LABEL[phase];
    $('phase-label').textContent = `${mapName} · ${label}`;
    $('phase-timer').textContent = phase === 'lobby' ? '' : clock(timeLeft);
  }

  me(me: PlayerSnap | undefined, phase: Phase, inHideout = false) {
    const role = $('role');
    if (!me) return;
    if (inHideout && phase === 'lobby') {
      role.textContent = `은신처 · ${characterOf(me.character).name} (C로 변경) · 출구 문으로 나가면 레이드 시작`;
      role.style.color = '#ffd27a';
    } else if (phase === 'lobby' || phase === 'countdown') {
      role.textContent = `대기실: ${characterOf(me.character).name} · ${characterOf(me.character).desc}`;
      role.style.color = '#ffd27a';
    } else if (me.extracted) {
      role.textContent = '탈출 성공: 관전 중';
      role.style.color = '#4cd964';
    } else if (me.role === 'spectator' || !me.alive) {
      role.textContent = me.role === 'spectator' ? '관전 중 (다음 라운드부터 참가)' : '사망: 관전 중';
      role.style.color = '#aaa';
    } else if (me.role === 'hunter') {
      role.textContent = '헌터: 숨은 프롭을 찾아 쏘세요';
      role.style.color = '#ff7a6b';
    } else {
      role.textContent = `${characterOf(me.character).name}: 숨고, 싸우고, 탈출하세요`;
      role.style.color = '#7ad0ff';
    }
    const fill = $('hp-fill');
    fill.style.width = `${(me.hp / me.maxHp) * 100}%`;
    const ratio = me.hp / me.maxHp;
    fill.style.background = ratio > 0.5 ? '#4cd964' : ratio > 0.25 ? '#ffcc00' : '#ff3b30';
    const cross = $('crosshair');
    cross.classList.toggle('hidden', !me.alive);
    cross.classList.toggle('prop', me.role === 'prop' && characterOf(me.character).weapon.kind !== 'hitscan');
  }

  /** The named area you're standing in, e.g. 사무실 inside the warehouse. */
  zone(name: string) {
    const el = $('zone');
    if (el.textContent !== name) el.textContent = name;
  }

  /** Sprint stamina, 0..1; orange while out of breath. Hidden when not moving around. */
  stamina(value: number | null, winded: boolean) {
    const bar = $('stamina-bar');
    bar.classList.toggle('hidden', value === null);
    bar.classList.toggle('winded', winded);
    $('stamina-fill').style.width = `${(value ?? 0) * 100}%`;
  }

  blind(show: boolean, timeLeft: number) {
    $('blind').classList.toggle('show', show);
    if (show) $('blind-text').innerHTML = `프롭들이 숨고 있어요<br>${Math.ceil(timeLeft)}`;
  }

  bag(items: string[], capacity: number, show: boolean) {
    const el = $('bag');
    if (!show) {
      el.textContent = '';
      return;
    }
    const names = items.map((i) => ITEMS[i].name).join(', ');
    el.textContent = `가방 ${items.length}/${capacity}${names ? `: ${names}` : ''}`;
  }

  extract(progress: number) {
    $('extract').classList.toggle('show', progress > 0);
    $('extract-fill').style.width = `${progress * 100}%`;
  }

  result(outcome: Outcome | null, items: string[]) {
    const el = $('result');
    if (!outcome) {
      el.textContent = '';
      return;
    }
    el.textContent = resultText(outcome, items);
  }

  hint(text: string) {
    $('hint').textContent = text;
  }

  center(text: string) {
    $('center-msg').textContent = text;
  }

  /** Teams when there were hunters; otherwise each player's own result. */
  roundEnd(winner: Team | null, outcome: Outcome | null) {
    if (winner) this.center(winner === 'hunters' ? '헌터 승리!' : '프롭 승리!');
    else this.center(outcome === 'extracted' ? '레이드 종료 · 탈출 성공!' : outcome === 'died' ? '레이드 종료 · 사망' : '레이드 종료');
  }

  kill(text: string) {
    const feed = $('killfeed');
    const row = document.createElement('div');
    row.textContent = text;
    feed.prepend(row);
    setTimeout(() => row.remove(), 6000);
    while (feed.children.length > 5) feed.lastChild?.remove();
  }

  private flash(id: string) {
    const el = $(id);
    el.classList.add('show');
    void el.offsetWidth;
    requestAnimationFrame(() => el.classList.remove('show'));
  }

  hitmarker() {
    this.flash('hitmarker');
  }

  damaged() {
    this.flash('damage-flash');
  }

  /** The Tab panel: what you carry this raid, what's banked (in the hideout only), and who's in the round. */
  inventory(show: boolean, inv: InventoryView) {
    const el = $('inventory');
    el.classList.toggle('hidden', !show);
    if (!show) return;
    const { bag, capacity, stash, players, visible, myId, canDrop } = inv;
    const item = (type: string, count?: number, drop?: number) => {
      const def = ITEMS[type];
      const color = `#${def.color.toString(16).padStart(6, '0')}`;
      const attrs = drop === undefined ? '' : ` data-drop="${drop}" title="클릭해서 버리기"`;
      return `<div class="slot${drop === undefined ? '' : ' droppable'}" style="--item:${color}"${attrs}><span>${def.name}</span>` +
        `<small>${count !== undefined ? `×${count} · ` : ''}${def.value * (count ?? 1)}</small></div>`;
    };
    const bagSlots = Array.from({ length: Math.max(capacity, bag.length) }, (_, i) =>
      bag[i] ? item(bag[i], undefined, canDrop ? i : undefined) : '<div class="slot empty"></div>').join('');
    const bagValue = bag.reduce((s, t) => s + ITEMS[t].value, 0);
    const stashed = Object.entries(stash ?? {}).filter(([, n]) => n > 0).sort(([a], [b]) => ITEMS[b].value - ITEMS[a].value);
    const stashValue = stashed.reduce((s, [t, n]) => s + ITEMS[t].value * n, 0);

    // Only your own HP: other players' numbers would hint at who is in view.
    const status = (p: RosterEntry) => (p.extracted ? '탈출' : !p.alive ? '사망' : p.id === myId ? visible.get(p.id)?.hp ?? '' : '생존');
    const section = (title: string, list: RosterEntry[]) =>
      list.length === 0 ? '' :
      `<h3>${title}</h3>` + list.map((p) =>
        `<div class="row ${p.alive ? '' : 'dead'}"><span>${escape(p.name)}${p.id === myId ? ' (나)' : ''}</span><span>${status(p)}</span></div>`,
      ).join('');
    const html =
      `<div class="inv-col"><h3>가방 <small>${bag.length}/${capacity} · 가치 ${bagValue}</small></h3>` +
      `<div class="slots">${bagSlots}</div>` +
      (!stash ? '' : `<h3>보관함 <small>가치 ${stashValue}</small></h3>` +
        (stashed.length ? `<div class="slots">${stashed.map(([t, n]) => item(t, n)).join('')}</div>` : '<p class="muted">아직 없어요. 아이템을 챙겨 탈출하세요.</p>')) +
      `</div><div class="inv-col players">` +
      section('헌터', players.filter((p) => p.role === 'hunter')) +
      section(players.some((p) => p.role === 'hunter') ? '프롭' : '플레이어', players.filter((p) => p.role === 'prop')) +
      section('관전', players.filter((p) => p.role === 'spectator')) +
      `</div><div class="inv-foot">${canDrop && bag.length ? '가방 아이템을 클릭하면 바닥에 버려요 · ' : ''}Tab 닫기</div>`;
    // Only touch the DOM when something changed, so hover and clicks aren't lost every frame.
    if (html !== this.inventoryHtml) {
      el.innerHTML = html;
      this.inventoryHtml = html;
    }
  }

  private inventoryHtml = '';
}

interface InventoryView {
  bag: string[];
  capacity: number;
  /** Null during a raid: the stash stays at home. */
  stash: Record<string, number> | null;
  players: RosterEntry[];
  visible: Map<number, PlayerSnap>;
  myId: number;
  /** Bag items can be dropped (alive, mid-raid). */
  canDrop: boolean;
}

export function resultText(outcome: Outcome, items: string[]) {
  const list = items.length ? items.map((i) => ITEMS[i].name).join(', ') : '없음';
  return {
    extracted: `탈출 성공! 보관함으로: ${list}`,
    survived: `생존! 보관함으로: ${list}`,
    died: items.length ? `사망: 잃은 아이템 ${list}` : '사망',
    mia: items.length ? `탈출 실패: 잃은 아이템 ${list}` : '탈출 실패',
  }[outcome];
}

function escape(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
