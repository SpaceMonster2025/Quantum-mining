export const CANVAS_WIDTH = window.innerWidth;
export const CANVAS_HEIGHT = window.innerHeight;

// Physics
export const FRICTION = 0.98;
export const SHIP_ACCEL = 0.15;
export const SHIP_ROTATION_SPEED = 0.08;
export const MAX_SPEED = 8;
export const LASER_RANGE = 250;
export const LASER_COOLDOWN = 10;
export const STATION_RADIUS = 150;
export const STATION_SHIELD_RADIUS = 220;

// Balance
export const STARTING_CREDITS = 100;
export const STARTING_AMMO = 3;
export const ORE_VALUE = 25;
export const MINE_TIMER_SECONDS = 3; // Shortened for gameplay flow
export const MINE_PUCKER_DURATION = 60; // Frames (approx 1 sec)
export const MINE_BLAST_RADIUS = 300;
export const MINE_PUCKER_FORCE = 0.5; // Suction force
export const MINE_BLAST_FORCE = 15;

// Entity Sizes
export const SHIP_RADIUS = 15;
export const TITAN_RADIUS = 60;
export const CHUNK_RADIUS = 25;
export const ORE_RADIUS = 5;
export const VOLATILE_RADIUS = 50;

// Colors
export const COLOR_BG = '#050505';
export const COLOR_SHIP = '#ffffff';
export const COLOR_THRUST = '#00ffff';
export const COLOR_LASER = '#ff00ff';
export const COLOR_ORE = '#4ade80'; // Neon Green
export const COLOR_TITAN = '#94a3b8'; // Slate 400
export const COLOR_VOLATILE = '#f97316'; // Orange 500
export const COLOR_CHUNK = '#64748b'; // Slate 500
export const COLOR_DANGER = '#ef4444'; // Red
export const COLOR_SHIELD = '#3b82f6'; // Blue
export const COLOR_STATION = '#facc15'; // Yellow

// Upgrade Costs
export const UPGRADE_COST_BASE = 150;
export const UPGRADE_COST_MULTIPLIER = 1.5;