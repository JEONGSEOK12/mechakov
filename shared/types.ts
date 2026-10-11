export type Vec3 = [number, number, number];

export type Role = 'hunter' | 'prop' | 'spectator';
export type Phase = 'lobby' | 'countdown' | 'hide' | 'hunt' | 'end';
export type Team = 'hunters' | 'props';

export interface Box {
  min: Vec3;
  max: Vec3;
}

export interface InputKeys {
  f: boolean;
  b: boolean;
  l: boolean;
  r: boolean;
  jump: boolean;
  sprint: boolean;
}
