import type { InputKeys } from '../../shared/types.ts';

const SENSITIVITY = 0.0022;

export class Controls {
  keys: InputKeys = { f: false, b: false, l: false, r: false, jump: false, sprint: false };
  yaw = 0;
  pitch = -0.15;
  locked = false;

  onShoot: () => void = () => {};
  onDisguise: () => void = () => {};
  onToggleRotationLock: () => void = () => {};
  onScoreboard: (show: boolean) => void = () => {};

  constructor(private canvas: HTMLElement) {
    canvas.addEventListener('click', () => {
      if (!this.locked) canvas.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * SENSITIVITY;
      this.pitch = Math.max(-1.2, Math.min(0.9, this.pitch - e.movementY * SENSITIVITY));
    });
    document.addEventListener('mousedown', (e) => {
      if (this.locked && e.button === 0) this.onShoot();
    });
    document.addEventListener('keydown', (e) => this.key(e, true));
    document.addEventListener('keyup', (e) => this.key(e, false));
    window.addEventListener('blur', () => {
      for (const k of Object.keys(this.keys) as (keyof InputKeys)[]) this.keys[k] = false;
    });
  }

  private key(e: KeyboardEvent, down: boolean) {
    if (e.target instanceof HTMLInputElement) return;
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': this.keys.f = down; break;
      case 'KeyS': case 'ArrowDown': this.keys.b = down; break;
      case 'KeyA': case 'ArrowLeft': this.keys.l = down; break;
      case 'KeyD': case 'ArrowRight': this.keys.r = down; break;
      case 'Space': this.keys.jump = down; break;
      case 'ShiftLeft': case 'ShiftRight': this.keys.sprint = down; break;
      case 'KeyE': if (down && !e.repeat) this.onDisguise(); break;
      case 'KeyR': if (down && !e.repeat) this.onToggleRotationLock(); break;
      case 'Tab': this.onScoreboard(down); break;
      default: return;
    }
    e.preventDefault();
  }
}
