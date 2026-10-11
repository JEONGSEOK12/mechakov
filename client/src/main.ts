import { Game } from './game.ts';
import { LocalNet } from './local.ts';
import { Net, type Connection } from './net.ts';

/** Built for a page with no game server (VITE_SOLO_ONLY=1): only solo play is offered. */
const SOLO_ONLY = import.meta.env.VITE_SOLO_ONLY === '1';

const form = document.getElementById('join') as HTMLFormElement;
const nameInput = document.getElementById('name') as HTMLInputElement;
const roomInput = document.getElementById('room') as HTMLInputElement;
const error = document.getElementById('join-error')!;

const params = new URLSearchParams(location.search);
try {
  nameInput.value = params.get('name') ?? localStorage.getItem('mechakov:name') ?? '';
} catch {
  nameInput.value = params.get('name') ?? '';
}
roomInput.value = params.get('room') ?? '';

function rememberName(name: string) {
  try {
    localStorage.setItem('mechakov:name', name);
  } catch {
    // Storage can be unavailable (private mode); the name just won't be remembered.
  }
}

function play(net: Connection, name: string, token?: string) {
  net.onMessage = (msg) => {
    if (msg.t === 'welcome') {
      try {
        if (net instanceof Net) localStorage.setItem('mechakov:token', msg.token);
      } catch {
        // Without storage the profile only lasts for this visit.
      }
      form.classList.add('hidden');
      new Game(net, msg.id, msg.seed, msg.theme, msg.profile).start();
    } else if (msg.t === 'error') {
      error.textContent = msg.message;
    }
  };
  net.send({ t: 'join', name, token });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (SOLO_ONLY) return;
  error.textContent = '';
  const name = nameInput.value.trim();
  rememberName(name);
  // An empty room name means quick play: the server picks a room.
  const net = new Net(roomInput.value.trim());
  try {
    await net.opened();
  } catch (err) {
    error.textContent = `${(err as Error).message} 서버 없이 하려면 '혼자 하기'를 눌러주세요.`;
    return;
  }
  let token: string | undefined;
  try {
    token = localStorage.getItem('mechakov:token') ?? undefined;
  } catch {
    token = undefined;
  }
  play(net, name, token);
});

document.getElementById('solo')!.addEventListener('click', () => {
  const name = nameInput.value.trim() || '나';
  rememberName(name);
  play(new LocalNet(), name);
});

if (SOLO_ONLY) {
  document.getElementById('online-join')!.classList.add('hidden');
  document.getElementById('solo')!.classList.remove('secondary');
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('solo')!.click();
  });
}

if (!SOLO_ONLY) fetch('/rooms')
  .then((r) => r.json())
  .then((d: { online: number }) => {
    document.getElementById('online')!.textContent = `지금 ${d.online}명 플레이 중`;
  })
  .catch(() => {});
