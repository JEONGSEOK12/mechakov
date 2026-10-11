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

  phase(phase: Phase, timeLeft: number, mapName: string) {
    $('phase-label').textContent = `${mapName} · ${PHASE_LABEL[phase]}`;
    $('phase-timer').textContent = phase === 'lobby' ? '' : clock(timeLeft);
  }

  me(me: PlayerSnap | undefined, phase: Phase) {
    const role = $('role');
    if (!me) return;
    if (phase === 'lobby' || phase === 'countdown') {
      role.textContent = '대기실: 변신 연습 중';
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
      role.textContent = '프롭: 사물로 변신해 숨으세요';
      role.style.color = '#7ad0ff';
    }
    const fill = $('hp-fill');
    fill.style.width = `${(me.hp / me.maxHp) * 100}%`;
    const ratio = me.hp / me.maxHp;
    fill.style.background = ratio > 0.5 ? '#4cd964' : ratio > 0.25 ? '#ffcc00' : '#ff3b30';
    $('crosshair').classList.toggle('hidden', !(me.alive && me.role === 'hunter'));
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
    const list = items.length ? items.map((i) => ITEMS[i].name).join(', ') : '없음';
    el.textContent = {
      extracted: `탈출 성공! 보관함으로: ${list}`,
      survived: `생존! 보관함으로: ${list}`,
      died: items.length ? `사망: 잃은 아이템 ${list}` : '사망',
      mia: items.length ? `탈출 실패: 잃은 아이템 ${list}` : '탈출 실패',
    }[outcome];
  }

  hint(text: string) {
    $('hint').textContent = text;
  }

  center(text: string) {
    $('center-msg').textContent = text;
  }

  roundEnd(winner: Team | null) {
    this.center(winner === 'hunters' ? '헌터 승리!' : winner === 'props' ? '프롭 승리!' : '라운드 취소');
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

  scoreboard(show: boolean, players: RosterEntry[], visible: Map<number, PlayerSnap>, myId: number) {
    const el = $('scoreboard');
    el.classList.toggle('hidden', !show);
    if (!show) return;
    // Only your own HP: other players' numbers would hint at who is in view.
    const status = (p: RosterEntry) => (p.extracted ? '탈출' : !p.alive ? '사망' : p.id === myId ? visible.get(p.id)?.hp ?? '' : '생존');
    const section = (title: string, list: RosterEntry[]) =>
      list.length === 0 ? '' :
      `<h3>${title}</h3>` + list.map((p) =>
        `<div class="row ${p.alive ? '' : 'dead'}"><span>${escape(p.name)}${p.id === myId ? ' (나)' : ''}</span><span>${status(p)}</span></div>`,
      ).join('');
    el.innerHTML =
      section('헌터', players.filter((p) => p.role === 'hunter')) +
      section('프롭', players.filter((p) => p.role === 'prop')) +
      section('관전', players.filter((p) => p.role === 'spectator'));
  }
}

function escape(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
