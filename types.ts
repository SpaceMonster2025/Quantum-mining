export enum GameState {
  MENU = 'MENU',
  PLAYING = 'PLAYING',
  DOCKED = 'DOCKED',
  GAME_OVER = 'GAME_OVER'
}

export interface Point {
  x: number;
  y: number;
}

export interface Vector {
  x: number;
  y: number;
}

export interface Entity extends Point {
  id: string;
  vx: number;
  vy: number;
  radius: number;
  angle: number;
  color: string;
}

export interface Particle extends Entity {
  life: number;
  maxLife: number;
  decay: number;
}

export enum AsteroidTier {
  TITAN = 1,    // Massive, needs bomb
  CHUNK = 2,    // Mineable with laser
  ORE = 3,      // Loot
  VOLATILE = 4  // Explosive, dangerous
}

export interface Asteroid extends Entity {
  tier: AsteroidTier;
  hp: number;
  rotationSpeed: number;
  shape: number[]; // Array of offsets for polygon drawing
}

export interface Mine extends Entity {
  timer: number;
  state: 'ARMED' | 'PUCKER' | 'DETONATING' | 'DEAD';
}

export interface Ship extends Entity {
  thrusting: boolean;
  reversing: boolean;
  rotatingLeft: boolean;
  rotatingRight: boolean;
  firing: boolean;
  hull: number;
  maxHull: number;
  shield: number;
  maxShield: number;
  cargo: number;
  maxCargo: number;
  credits: number;
  ammo: number; // Quantum charges
  invulnerableTimer: number;
}

export interface Upgrades {
  engineLevel: number;
  handlingLevel: number;
  hullLevel: number;
  cargoLevel: number;
  laserLevel: number;
  shieldLevel: number;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}