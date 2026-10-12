import type { InputKeys } from '../../shared/types.ts';

const SENSITIVITY = 0.0022;

export class Controls {
  keys: InputKeys = { f: false, b: false, l: false, r: false, jump: false, sprint: false };
  yaw = 0;
  pitch = -0.15;
  locked = false;
  /** Fallback when the page can't lock the mouse: drag to look, click to shoot. */
  dragMode = false;
  private dragStart: { x: number; y: number; moved: number } | null = null;

  get active() {
    return this.locked || this.dragMode;
  }

  onShoot: () => void = () => {};
  onCharacter: () => void = () => {};
  onSkill: () => void = () => {};
  /** The fire button is down (for guns that keep firing while held). */
  firing = false;
  onDisguise: () => void = () => {};
  onPickup: () => void = () => {};
  onHideout: () => void = () => {};
  onAddBot: () => void = () => {};
  onMute: () => void = () => {};
  onMap: () => void = () => {};
  onToggleRotationLock: () => void = () => {};
  onInventory: () => void = () => {};

  constructor(private canvas: HTMLElement) {
    canvas.addEventListener('click', () => {
      if (this.locked || this.dragMode) return;
      try {
        const result = canvas.requestPointerLock() as unknown;
        if (result instanceof Promise) result.catch(() => (this.dragMode = true));
      } catch {
        this.dragMode = true;
      }
    });
    document.addEventListener('pointerlockerror', () => {
      this.dragMode = true;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (this.dragMode && e.button === 0) this.dragStart = { x: e.clientX, y: e.clientY, moved: 0 };
    });
    document.addEventListener('mouseup', (e) => {
      if (this.dragMode && this.dragStart && e.button === 0 && this.dragStart.moved < 6) this.onShoot();
      this.dragStart = null;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
    document.addEventListener('mousemove', (e) => {
      if (this.dragMode && this.dragStart) {
        this.dragStart.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
        this.yaw -= e.movementX * SENSITIVITY * 1.5;
        this.pitch = Math.max(-1.2, Math.min(0.9, this.pitch - e.movementY * SENSITIVITY * 1.5));
        return;
      }
      if (!this.locked) return;
      this.yaw -= e.movementX * SENSITIVITY;
      this.pitch = Math.max(-1.2, Math.min(0.9, this.pitch - e.movementY * SENSITIVITY));
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 2) this.onSkill();
      if (e.button !== 0) return;
      this.firing = true;
      this.onShoot();
    });
    document.addEventListener('contextmenu', (e) => {
      if (this.locked) e.preventDefault();
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
    });
    document.addEventListener('keydown', (e) => this.key(e, true));
    document.addEventListener('keyup', (e) => this.key(e, false));
    window.addEventListener('blur', () => {
      this.firing = false;
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
      case 'KeyF': if (down && !e.repeat) this.onPickup(); break;
      case 'KeyH': if (down && !e.repeat) this.onHideout(); break;
      case 'KeyB': if (down && !e.repeat) this.onAddBot(); break;
      case 'KeyQ': if (down && !e.repeat) this.onSkill(); break;
      case 'KeyC': if (down && !e.repeat) this.onCharacter(); break;
      case 'KeyM': if (down && !e.repeat) this.onMap(); break;
      case 'KeyN': if (down && !e.repeat) this.onMute(); break;
      case 'Tab': if (down && !e.repeat) this.onInventory(); break;
      default: return;
    }
    e.preventDefault();
  }
}
