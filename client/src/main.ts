import { Game } from './game.ts';
import { Net } from './net.ts';

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

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  error.textContent = '';
  const name = nameInput.value.trim();
  const room = roomInput.value.trim() || 'main';
  try {
    localStorage.setItem('mechakov:name', name);
  } catch {
    // Storage can be unavailable (private mode); the name just won't be remembered.
  }
  const net = new Net(room);
  try {
    await net.opened();
  } catch (err) {
    error.textContent = (err as Error).message;
    return;
  }
  net.onMessage = (msg) => {
    if (msg.t === 'welcome') {
      try {
        localStorage.setItem('mechakov:token', msg.token);
      } catch {
        // Without storage the profile only lasts for this visit.
      }
      form.classList.add('hidden');
      new Game(net, msg.id, msg.seed, msg.profile).start();
    } else if (msg.t === 'error') {
      error.textContent = msg.message;
    }
  };
  let token: string | undefined;
  try {
    token = localStorage.getItem('mechakov:token') ?? undefined;
  } catch {
    token = undefined;
  }
  net.send({ t: 'join', name, token });
});
