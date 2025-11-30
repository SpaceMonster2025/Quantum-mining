import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Asteroid, AsteroidTier, GameState, Mine, Particle, Ship, Upgrades } from '../types';
import { 
  FRICTION, SHIP_ACCEL, SHIP_ROTATION_SPEED, 
  MAX_SPEED, LASER_RANGE, SHIP_RADIUS, MINE_PUCKER_DURATION, MINE_BLAST_RADIUS,
  COLOR_ORE, COLOR_TITAN, COLOR_CHUNK, COLOR_DANGER, COLOR_SHIP, COLOR_THRUST,
  STATION_RADIUS, COLOR_STATION, COLOR_SHIELD, MINE_PUCKER_FORCE, MINE_BLAST_FORCE,
  TITAN_RADIUS, CHUNK_RADIUS, ORE_RADIUS, VOLATILE_RADIUS, COLOR_VOLATILE, COLOR_LASER,
  STATION_SHIELD_RADIUS
} from '../constants';
import { distance, randomRange, checkCollision, generatePolygonOffsets } from '../utils/physics';
import { audio } from '../utils/audio';

interface GameCanvasProps {
  gameState: GameState;
  setGameState: (state: GameState) => void;
  shipRef: React.MutableRefObject<Ship>;
  upgradesRef: React.MutableRefObject<Upgrades>;
  syncUI: () => void;
  sector: number;
  onSectorCleared: (stats: { percent: number; ore: number }) => void;
}

const GameCanvas: React.FC<GameCanvasProps> = ({ 
  gameState, setGameState, shipRef, upgradesRef, syncUI, sector, onSectorCleared 
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(0);
  const prevGameState = useRef<GameState>(gameState);
  const prevSector = useRef<number>(sector);
  
  // Track window size dynamically
  const [screenSize, setScreenSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  // Mutable Game State (Kept in refs for performance)
  const asteroidsRef = useRef<Asteroid[]>([]);
  const minesRef = useRef<Mine[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const cameraRef = useRef({ x: 0, y: 0, zoom: 0.8 }); // Initialize with slight zoom out
  const shakeRef = useRef<number>(0); // Screen shake magnitude
  const keysPressed = useRef<Set<string>>(new Set());
  const mouseRef = useRef({ x: 0, y: 0, down: false, rightDown: false });
  const levelInitialAsteroids = useRef<number>(0);
  const sectorOreCollected = useRef<number>(0);
  
  // Laser State for separation of logic/render
  const laserRef = useRef({ active: false, x: 0, y: 0, length: 0, angle: 0 });

  // --- Initialization ---

  const spawnAsteroid = (tier: AsteroidTier, x: number, y: number, vx: number, vy: number) => {
    let size = ORE_RADIUS;
    let color = COLOR_ORE;
    let hp = 1;
    let sides = 8;
    let variance = 0.2;

    if (tier === AsteroidTier.TITAN) {
        size = TITAN_RADIUS;
        color = COLOR_TITAN;
        hp = 1000;
        sides = 12;
    } else if (tier === AsteroidTier.VOLATILE) {
        size = VOLATILE_RADIUS;
        color = COLOR_VOLATILE;
        hp = 800;
        sides = 10;
        variance = 0.4; // Spikier
    } else if (tier === AsteroidTier.CHUNK) {
        size = CHUNK_RADIUS;
        color = COLOR_CHUNK;
        hp = 50;
    }

    asteroidsRef.current.push({
      id: Math.random().toString(36).substr(2, 9),
      x, y, vx, vy,
      radius: size,
      angle: Math.random() * Math.PI * 2,
      color,
      tier,
      hp,
      rotationSpeed: randomRange(-0.02, 0.02),
      shape: generatePolygonOffsets(sides, variance)
    });
  };

  // Helper to handle asteroid destruction logic
  const breakAsteroid = (ast: Asteroid, impactVx: number, impactVy: number) => {
    // Visual Dust
    spawnParticles(ast.x, ast.y, ast.color, 8, 2, 25);
    
    if (ast.tier === AsteroidTier.VOLATILE) {
        // Volatile Explosion
        audio.playExplosion('large');
        shakeRef.current += 15;
        
        // Spawn FAST chunks (dangerous shrapnel)
        const chunkCount = 8;
        for (let i = 0; i < chunkCount; i++) {
            const angle = randomRange(0, Math.PI * 2);
            const speed = randomRange(8, 14); // High velocity!
            spawnAsteroid(
              AsteroidTier.CHUNK,
              ast.x + Math.cos(angle) * 10,
              ast.y + Math.sin(angle) * 10,
              impactVx * 0.3 + Math.cos(angle) * speed,
              impactVy * 0.3 + Math.sin(angle) * speed
            );
        }
    } else if (ast.tier === AsteroidTier.TITAN) {
      audio.playExplosion('large');
      // Titan -> Chunks
      for (let i = 0; i < 5; i++) {
        const angle = randomRange(0, Math.PI * 2);
        const speed = randomRange(1, 4);
        spawnAsteroid(
          AsteroidTier.CHUNK,
          ast.x + Math.cos(angle) * 10,
          ast.y + Math.sin(angle) * 10,
          impactVx * 0.3 + Math.cos(angle) * speed,
          impactVy * 0.3 + Math.sin(angle) * speed
        );
      }
    } else if (ast.tier === AsteroidTier.CHUNK) {
      audio.playExplosion('small');
      // Chunk -> Ore
      const oreCount = 10; 
      for (let i = 0; i < oreCount; i++) {
        const angle = randomRange(0, Math.PI * 2);
        const speed = randomRange(2, 5);
        spawnAsteroid(
          AsteroidTier.ORE,
          ast.x + Math.cos(angle) * 5,
          ast.y + Math.sin(angle) * 5,
          impactVx * 0.3 + Math.cos(angle) * speed,
          impactVy * 0.3 + Math.sin(angle) * speed
        );
      }
    }
  };

  const initGame = useCallback(() => {
    // Reset Ship physics only, keep upgrades/credits
    shipRef.current = {
      ...shipRef.current,
      x: 0, y: 0, vx: 0, vy: -4, angle: -Math.PI / 2, 
      invulnerableTimer: 60 // Brief iframe on spawn
    };
    
    asteroidsRef.current = [];
    minesRef.current = [];
    particlesRef.current = [];
    cameraRef.current.zoom = 0.8;
    shakeRef.current = 0;
    sectorOreCollected.current = 0;

    // Difficulty Scaling based on Sector
    let volatileCount = 0;
    let titanCount = 0;

    if (sector === 1) {
        // Sector 1: Exactly 4 Titans, no volatiles
        titanCount = 4;
        volatileCount = 0;
    } else {
        // Scaling: Start with 4, add random amount per sector level
        // e.g. Sector 2 gets 4 + random(2, 5) extra.
        const extraPerLevel = (sector - 1) * randomRange(2, 5); 
        titanCount = Math.floor(4 + extraPerLevel);
        volatileCount = Math.floor((sector - 1) * 2); // 0, 2, 4...
    }
    
    // Total trackable targets (Volatile + Titan)
    levelInitialAsteroids.current = volatileCount + titanCount;

    // Spawn Volatiles
    for (let i = 0; i < volatileCount; i++) {
        const dist = randomRange(800, 3000 + (sector * 200));
        const theta = Math.random() * Math.PI * 2;
        spawnAsteroid(
            AsteroidTier.VOLATILE,
            Math.cos(theta) * dist,
            Math.sin(theta) * dist,
            randomRange(-0.8, 0.8), // Slightly faster
            randomRange(-0.8, 0.8)
        );
    }

    // Spawn Titans
    for (let i = 0; i < titanCount; i++) {
      const dist = randomRange(500, 3000 + (sector * 200));
      const theta = Math.random() * Math.PI * 2;
      spawnAsteroid(
        AsteroidTier.TITAN,
        Math.cos(theta) * dist,
        Math.sin(theta) * dist,
        randomRange(-0.5, 0.5),
        randomRange(-0.5, 0.5)
      );
    }
    
    // Spawn some ambient Ore for immediate engagement
    for(let i=0; i<10; i++) {
        const dist = randomRange(400, 1000);
        const theta = Math.random() * Math.PI * 2;
        spawnAsteroid(AsteroidTier.ORE, Math.cos(theta)*dist, Math.sin(theta)*dist, 0,0);
    }

  }, [shipRef, sector]);

  // --- Particles ---

  const spawnParticles = (x: number, y: number, color: string, count: number, speed: number, life: number) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const v = randomRange(speed * 0.5, speed);
      particlesRef.current.push({
        id: Math.random().toString(),
        x, y,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v,
        radius: randomRange(1, 3),
        color,
        angle: 0,
        life: life,
        maxLife: life,
        decay: 1
      });
    }
  };

  // --- Physics Loop ---

  const update = useCallback(() => {
    if (gameState !== GameState.PLAYING) {
        // Stop loops if paused/docked/gameover
        audio.setThrust(false);
        audio.setLaser(false);
        audio.setTractor(false);
        return;
    }

    const ship = shipRef.current;
    const upgrades = upgradesRef.current;
    
    // 0. Screen Shake Decay
    if (shakeRef.current > 0) {
      shakeRef.current *= 0.9;
      if (shakeRef.current < 0.5) shakeRef.current = 0;
    }

    // 1. Ship Controls
    if (keysPressed.current.has('w') || keysPressed.current.has('arrowup')) {
      ship.vx += Math.cos(ship.angle) * (SHIP_ACCEL + (upgrades.engineLevel * 0.02));
      ship.vy += Math.sin(ship.angle) * (SHIP_ACCEL + (upgrades.engineLevel * 0.02));
      ship.thrusting = true;
      audio.setThrust(true);
      // Thruster particles
      spawnParticles(
        ship.x - Math.cos(ship.angle) * 20, 
        ship.y - Math.sin(ship.angle) * 20, 
        COLOR_THRUST, 1, 1, 15
      );
    } else {
      ship.thrusting = false;
      audio.setThrust(false);
    }

    // Reverse Thrust (S)
    if (keysPressed.current.has('s') || keysPressed.current.has('arrowdown')) {
       const reverseAccel = (SHIP_ACCEL + (upgrades.engineLevel * 0.02)) * 0.5;
       ship.vx -= Math.cos(ship.angle) * reverseAccel;
       ship.vy -= Math.sin(ship.angle) * reverseAccel;
       
       // Reverse Thruster Particles
       spawnParticles(
         ship.x + Math.cos(ship.angle) * 15 + Math.cos(ship.angle + Math.PI/2) * 10, 
         ship.y + Math.sin(ship.angle) * 15 + Math.sin(ship.angle + Math.PI/2) * 10, 
         '#94a3b8', 1, 0.5, 8
       );
       spawnParticles(
         ship.x + Math.cos(ship.angle) * 15 + Math.cos(ship.angle - Math.PI/2) * 10, 
         ship.y + Math.sin(ship.angle) * 15 + Math.sin(ship.angle - Math.PI/2) * 10, 
         '#94a3b8', 1, 0.5, 8
       );
    }

    // Space Brake (Q)
    if (keysPressed.current.has('q')) {
        ship.vx *= 0.9;
        ship.vy *= 0.9;
        if (Math.abs(ship.vx) < 0.01) ship.vx = 0;
        if (Math.abs(ship.vy) < 0.01) ship.vy = 0;
        
        if (Math.random() > 0.8 && (Math.abs(ship.vx) > 0.1 || Math.abs(ship.vy) > 0.1)) {
           spawnParticles(ship.x, ship.y, '#64748b', 1, 1, 5);
        }
    }

    const rotSpeed = SHIP_ROTATION_SPEED + (upgrades.handlingLevel * 0.01);
    if (keysPressed.current.has('a') || keysPressed.current.has('arrowleft')) ship.angle -= rotSpeed;
    if (keysPressed.current.has('d') || keysPressed.current.has('arrowright')) ship.angle += rotSpeed;

    // Cap speed
    const velocity = Math.sqrt(ship.vx * ship.vx + ship.vy * ship.vy);
    const maxSpeed = MAX_SPEED + (upgrades.engineLevel * 0.5);
    if (velocity > maxSpeed) {
      ship.vx = (ship.vx / velocity) * maxSpeed;
      ship.vy = (ship.vy / velocity) * maxSpeed;
    }

    // Apply Friction
    ship.vx *= FRICTION;
    ship.vy *= FRICTION;
    ship.x += ship.vx;
    ship.y += ship.vy;

    // 2. Camera Follow with Zoom
    const zoom = cameraRef.current.zoom;
    cameraRef.current.x = ship.x - (screenSize.width / 2) / zoom;
    cameraRef.current.y = ship.y - (screenSize.height / 2) / zoom;

    // 3. Mining Laser Logic
    laserRef.current.active = false;
    audio.setLaser(mouseRef.current.down);
    
    if (mouseRef.current.down) {
      const centerX = screenSize.width / 2;
      const centerY = screenSize.height / 2;
      const dx = mouseRef.current.x - centerX;
      const dy = mouseRef.current.y - centerY;
      const aimAngle = Math.atan2(dy, dx);
      
      laserRef.current = {
          active: true,
          x: ship.x,
          y: ship.y,
          angle: aimAngle,
          length: LASER_RANGE
      };
      
      let closestAst: Asteroid | null = null;
      let closestDist = LASER_RANGE;
      const laserPower = 1 + (upgrades.laserLevel * 0.5);

      asteroidsRef.current.forEach(ast => {
        if (ast.tier === AsteroidTier.TITAN || ast.tier === AsteroidTier.VOLATILE || ast.tier === AsteroidTier.ORE) return;
        const dToAst = distance({x: ship.x, y: ship.y}, ast);
        if (dToAst < LASER_RANGE + ast.radius) {
          const angleToAst = Math.atan2(ast.y - ship.y, ast.x - ship.x);
          let angleDiff = angleToAst - aimAngle;
          while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
          while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
          if (Math.abs(angleDiff) < 0.2) {
             if (dToAst < closestDist) {
                 closestDist = dToAst;
                 closestAst = ast;
             }
          }
        }
      });

      if (closestAst) {
         const ast = closestAst as Asteroid;
         const wasAlive = ast.hp > 0;
         ast.hp -= laserPower;
         const impactDist = Math.max(0, closestDist - ast.radius);
         laserRef.current.length = impactDist;
         const impactX = ship.x + Math.cos(aimAngle) * impactDist;
         const impactY = ship.y + Math.sin(aimAngle) * impactDist;
         spawnParticles(impactX, impactY, COLOR_ORE, 2, 2, 10);
         if (wasAlive && ast.hp <= 0) breakAsteroid(ast, 0, 0); 
      }
      asteroidsRef.current = asteroidsRef.current.filter(a => a.hp > 0);
    }

    // 4. Tractor Beam
    audio.setTractor(mouseRef.current.rightDown);
    if (mouseRef.current.rightDown) {
      const TRACTOR_RANGE = 500;
      const TRACTOR_FORCE = 0.5;
      asteroidsRef.current.forEach(ast => {
        if (ast.tier === AsteroidTier.ORE) {
          const dist = distance(ship, ast);
          if (dist < TRACTOR_RANGE) {
            const angle = Math.atan2(ship.y - ast.y, ship.x - ast.x);
            ast.vx += Math.cos(angle) * TRACTOR_FORCE;
            ast.vy += Math.sin(angle) * TRACTOR_FORCE;
            ast.vx += randomRange(-0.2, 0.2);
            ast.vy += randomRange(-0.2, 0.2);
          }
        }
      });
    }

    // 5. Mines
    minesRef.current.forEach(mine => {
      mine.timer--;
      if (mine.timer === MINE_PUCKER_DURATION) audio.playMinePucker();
      
      if (mine.timer > 0 && mine.timer < MINE_PUCKER_DURATION) {
        mine.state = 'PUCKER';
        asteroidsRef.current.forEach(ast => {
          const d = distance(mine, ast);
          if (d < MINE_BLAST_RADIUS * 1.5) {
            const angle = Math.atan2(mine.y - ast.y, mine.x - ast.x);
            ast.vx += Math.cos(angle) * MINE_PUCKER_FORCE;
            ast.vy += Math.sin(angle) * MINE_PUCKER_FORCE;
          }
        });
        const dShip = distance(mine, ship);
        if (dShip < MINE_BLAST_RADIUS * 1.5) {
          const angle = Math.atan2(mine.y - ship.y, mine.x - ship.x);
          ship.vx += Math.cos(angle) * MINE_PUCKER_FORCE * 0.5;
          ship.vy += Math.sin(angle) * MINE_PUCKER_FORCE * 0.5;
        }
        // Suction Particles
        for(let i=0; i<3; i++) {
           const angle = Math.random() * Math.PI * 2;
           const dist = MINE_BLAST_RADIUS * (0.8 + Math.random() * 0.4);
           const px = mine.x + Math.cos(angle) * dist;
           const py = mine.y + Math.sin(angle) * dist;
           const speed = randomRange(3, 6);
           particlesRef.current.push({
               id: Math.random().toString(),
               x: px, y: py,
               vx: -Math.cos(angle) * speed,
               vy: -Math.sin(angle) * speed,
               radius: randomRange(1, 2),
               color: Math.random() > 0.5 ? '#ffffff' : COLOR_DANGER,
               angle: 0, life: 30, maxLife: 30, decay: 1
           });
        }
      } else if (mine.timer <= 0) {
        mine.state = 'DETONATING';
        audio.playExplosion('large');
        shakeRef.current = 25;
        // Visual Explosion
        spawnParticles(mine.x, mine.y, COLOR_DANGER, 60, 15, 45);
        spawnParticles(mine.x, mine.y, '#fbbf24', 40, 12, 40);
        spawnParticles(mine.x, mine.y, '#ffffff', 20, 18, 25);
        
        asteroidsRef.current.forEach(ast => {
          const d = distance(mine, ast);
          if (d < MINE_BLAST_RADIUS) {
            const angle = Math.atan2(ast.y - mine.y, ast.x - mine.x);
            const force = MINE_BLAST_FORCE * (1 - d/MINE_BLAST_RADIUS);
            ast.vx += Math.cos(angle) * force;
            ast.vy += Math.sin(angle) * force;

            const wasAlive = ast.hp > 0;
            if (ast.tier === AsteroidTier.TITAN || ast.tier === AsteroidTier.VOLATILE) {
               ast.hp = 0; // Destroy Titans/Volatiles instantly
            } else if (ast.tier !== AsteroidTier.ORE) {
               ast.hp -= 100;
            }

            if (wasAlive && ast.hp <= 0) {
               breakAsteroid(ast, Math.cos(angle) * force, Math.sin(angle) * force);
            }
          }
        });

        const dShip = distance(mine, ship);
        if (dShip < MINE_BLAST_RADIUS) {
          const angle = Math.atan2(ship.y - mine.y, ship.x - mine.x);
          const force = MINE_BLAST_FORCE * 1.5 * (1 - dShip/MINE_BLAST_RADIUS);
          ship.vx += Math.cos(angle) * force;
          ship.vy += Math.sin(angle) * force;
          if (ship.invulnerableTimer <= 0) {
             if (ship.shield > 0) {
                ship.shield = 0;
                ship.invulnerableTimer = 60;
             } else {
                ship.hull -= 50 * (1 - dShip/MINE_BLAST_RADIUS);
                ship.invulnerableTimer = 30;
             }
             syncUI();
          }
        }
      }
    });
    
    minesRef.current = minesRef.current.filter(m => m.state !== 'DETONATING');
    asteroidsRef.current = asteroidsRef.current.filter(a => a.hp > 0);

    // 6. Asteroid Physics & Collision & Shield Logic
    let titansLeft = 0;

    asteroidsRef.current.forEach(ast => {
      // Station Shield Collision
      const distToStation = distance({x:0, y:0}, ast);
      const shieldDist = STATION_SHIELD_RADIUS + ast.radius;
      
      if (distToStation < shieldDist) {
        // Bounce off shield
        const angle = Math.atan2(ast.y, ast.x);
        const overlap = shieldDist - distToStation;
        
        // Move out
        ast.x += Math.cos(angle) * overlap;
        ast.y += Math.sin(angle) * overlap;
        
        // Reflect velocity
        const nx = Math.cos(angle);
        const ny = Math.sin(angle);
        const dot = ast.vx * nx + ast.vy * ny;
        
        if (dot < 0) {
            ast.vx = (ast.vx - 2 * dot * nx) * 0.5; // Dampen bounce
            ast.vy = (ast.vy - 2 * dot * ny) * 0.5;
            // Shield hit particles
            spawnParticles(ast.x - nx * ast.radius, ast.y - ny * ast.radius, '#60a5fa', 3, 1, 10);
        }
      }

      ast.x += ast.vx;
      ast.y += ast.vy;
      ast.angle += ast.rotationSpeed;
      ast.vx *= 0.99;
      ast.vy *= 0.99;

      if (ast.tier === AsteroidTier.TITAN || ast.tier === AsteroidTier.VOLATILE) {
          titansLeft++;
      }

      if (checkCollision(ship, ast)) {
        if (ast.tier === AsteroidTier.ORE) {
          if (ship.cargo < ship.maxCargo) {
            ship.cargo++;
            sectorOreCollected.current++; // Track for report
            ast.hp = 0;
            audio.playPickup();
            syncUI();
          }
        } else {
          if (ship.invulnerableTimer <= 0) {
             const vRel = Math.sqrt(Math.pow(ship.vx - ast.vx, 2) + Math.pow(ship.vy - ast.vy, 2));
             // Higher damage threshold for collision, Volatiles always hurt or Chunks moving fast
             if (vRel > 2 || ast.tier === AsteroidTier.VOLATILE) {
               shakeRef.current = 5;
               if (ship.shield > 0) {
                  ship.shield = 0;
               } else {
                  let damage = 20;
                  if (ast.tier === AsteroidTier.TITAN) damage = 100;
                  if (ast.tier === AsteroidTier.VOLATILE) damage = 150; // Dangerous
                  ship.hull -= damage;
               }
               ship.invulnerableTimer = 60;
               const angle = Math.atan2(ship.y - ast.y, ship.x - ast.x);
               ship.vx += Math.cos(angle) * 8; // Bounce hard
               ship.vy += Math.sin(angle) * 8;
               audio.playExplosion('small');
               syncUI();
             }
          }
        }
      }
    });

    // 6b. Sector Completion Check
    // If < 10% of initial big asteroids remain
    if (levelInitialAsteroids.current > 0 && titansLeft <= levelInitialAsteroids.current * 0.1) {
        // Only trigger once per level. Check against gameState ensures we don't trigger repeatedly while waiting in the menu
        if (sector === prevSector.current && gameState === GameState.PLAYING) {
             const destroyed = levelInitialAsteroids.current - titansLeft;
             const percent = Math.floor((destroyed / levelInitialAsteroids.current) * 100);
             onSectorCleared({ percent, ore: sectorOreCollected.current });
        }
    }

    // 7. Station Docking
    const distToStation = distance({x:0, y:0}, ship);
    if (distToStation < STATION_RADIUS + SHIP_RADIUS && Math.abs(ship.vx) < 1 && Math.abs(ship.vy) < 1) {
       setGameState(GameState.DOCKED);
       audio.playUI('buy'); 
    }

    // 8. Particles
    particlesRef.current.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.life--;
    });
    particlesRef.current = particlesRef.current.filter(p => p.life > 0);

    if (ship.invulnerableTimer > 0) ship.invulnerableTimer--;
    if (ship.hull <= 0) {
      setGameState(GameState.GAME_OVER);
      audio.playExplosion('large');
    }

  }, [gameState, setGameState, syncUI, shipRef, upgradesRef, screenSize, sector, onSectorCleared]);

  // --- Render Loop ---
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear Background
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, screenSize.width, screenSize.height);

    const zoom = cameraRef.current.zoom;
    const shake = shakeRef.current;

    ctx.save();
    ctx.scale(zoom, zoom);
    const shakeX = (Math.random() - 0.5) * shake;
    const shakeY = (Math.random() - 0.5) * shake;
    ctx.translate(-cameraRef.current.x + shakeX, -cameraRef.current.y + shakeY);

    // Grid
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const gridSize = 200;
    const worldLeft = cameraRef.current.x;
    const worldTop = cameraRef.current.y;
    const worldWidth = screenSize.width / zoom;
    const worldHeight = screenSize.height / zoom;
    const startX = Math.floor(worldLeft / gridSize) * gridSize;
    const startY = Math.floor(worldTop / gridSize) * gridSize;
    
    for (let x = startX; x < worldLeft + worldWidth + gridSize; x += gridSize) {
      ctx.moveTo(x, startY - gridSize);
      ctx.lineTo(x, startY + worldHeight + gridSize);
    }
    for (let y = startY; y < worldTop + worldHeight + gridSize; y += gridSize) {
      ctx.moveTo(startX - gridSize, y);
      ctx.lineTo(startX + worldWidth + gridSize, y);
    }
    ctx.stroke();

    // Station (Procedural)
    const time = Date.now();
    const slowRot = time * 0.0002;
    const medRot = time * 0.0005;

    // Force Shield
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, STATION_SHIELD_RADIUS, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.5)';
    ctx.lineWidth = 2;
    ctx.setLineDash([20, 10]);
    ctx.rotate(time * 0.0001);
    ctx.stroke();
    // Inner pulse
    ctx.beginPath();
    ctx.arc(0, 0, STATION_SHIELD_RADIUS - 10, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.2)';
    ctx.lineWidth = 1;
    ctx.setLineDash([10, 20]);
    ctx.rotate(-time * 0.0002);
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = 'rgba(250, 204, 21, 0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    ctx.arc(0, 0, STATION_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.save();
    ctx.rotate(slowRot);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 8;
    for(let i=0; i<3; i++) {
        const angle = (i * Math.PI * 2) / 3;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(angle) * 100, Math.sin(angle) * 100); ctx.stroke();
    }
    ctx.strokeStyle = '#475569'; ctx.lineWidth = 24; ctx.beginPath(); ctx.arc(0, 0, 100, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 2;
    for(let i=0; i<12; i++) {
        const angle = (i * Math.PI * 2) / 12;
        const x1 = Math.cos(angle) * 88; const y1 = Math.sin(angle) * 88;
        const x2 = Math.cos(angle) * 112; const y2 = Math.sin(angle) * 112;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.shadowBlur = 10; ctx.shadowColor = COLOR_STATION; ctx.fillStyle = COLOR_STATION;
    for(let i=0; i<6; i++) {
        const angle = (i * Math.PI * 2) / 6 + (Math.PI/6);
        const x = Math.cos(angle) * 100; const y = Math.sin(angle) * 100;
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.restore();

    ctx.fillStyle = '#0f172a'; ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0, 0, 40, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

    ctx.fillStyle = '#bae6fd'; ctx.shadowColor = '#bae6fd'; ctx.shadowBlur = 5;
    const coreTime = Math.floor(time / 500); 
    const winSize = 6;
    for(let i=-2; i<=2; i++) {
        for(let j=-2; j<=2; j++) {
            if (Math.abs(i) + Math.abs(j) < 4) { 
                if ((i+j+coreTime) % 7 !== 0) ctx.fillRect(i*10 - winSize/2, j*10 - winSize/2, winSize, winSize);
            }
        }
    }
    ctx.shadowBlur = 0;

    ctx.save();
    ctx.rotate(-medRot * 2);
    ctx.strokeStyle = '#64748b'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, -60, 10, 0, Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -40); ctx.lineTo(0, -60); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 40); ctx.lineTo(0, 80); ctx.stroke();
    if (Math.floor(time / 200) % 2 === 0) {
        ctx.fillStyle = '#ef4444'; ctx.shadowColor = '#ef4444'; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(0, 80, 4, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    }
    ctx.restore();

    ctx.font = 'bold 16px monospace'; ctx.fillStyle = 'rgba(250, 204, 21, 0.7)';
    ctx.textAlign = 'center'; ctx.fillText('STATION HUB', 0, 140);

    // Particles
    particlesRef.current.forEach(p => {
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.shadowBlur = 5; ctx.shadowColor = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1.0;

    // Mines
    minesRef.current.forEach(m => {
      ctx.shadowBlur = 15; ctx.shadowColor = COLOR_DANGER; ctx.fillStyle = COLOR_DANGER;
      let radius = 10;
      if (m.state === 'PUCKER') {
        radius = 5 + Math.random() * 2;
        ctx.strokeStyle = COLOR_DANGER; ctx.beginPath();
        for(let i=0; i<4; i++) {
           const a = (Date.now() / 100) + (i * Math.PI / 2);
           ctx.moveTo(m.x + Math.cos(a)*50, m.y + Math.sin(a)*50); ctx.lineTo(m.x, m.y);
        }
        ctx.stroke();
      } else if (Math.floor(Date.now() / 200) % 2 === 0) {
        ctx.fillStyle = '#fff';
      }
      ctx.beginPath(); ctx.arc(m.x, m.y, radius, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.2)'; ctx.lineWidth = 1; ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.arc(m.x, m.y, MINE_BLAST_RADIUS, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    });

    // Asteroids
    asteroidsRef.current.forEach(ast => {
      ctx.save(); ctx.translate(ast.x, ast.y); ctx.rotate(ast.angle);
      
      ctx.shadowBlur = (ast.tier === AsteroidTier.ORE || ast.tier === AsteroidTier.VOLATILE) ? 10 : 0;
      ctx.shadowColor = ast.color;
      ctx.strokeStyle = ast.color;
      ctx.fillStyle = ast.tier === AsteroidTier.ORE ? ast.color : 'transparent';
      ctx.lineWidth = 2;

      ctx.beginPath();
      if (ast.tier === AsteroidTier.ORE) {
         ctx.arc(0, 0, ast.radius, 0, Math.PI * 2); ctx.fill();
      } else {
         const sides = ast.shape.length;
         const angleStep = (Math.PI * 2) / sides;
         ctx.moveTo(ast.radius * ast.shape[0], 0);
         for(let i=1; i<sides; i++) {
           ctx.lineTo(Math.cos(i * angleStep) * ast.radius * ast.shape[i], Math.sin(i * angleStep) * ast.radius * ast.shape[i]);
         }
         ctx.closePath();
         ctx.stroke();

         if (ast.tier === AsteroidTier.VOLATILE) {
            // Volatile core pulsation
            const pulse = 0.5 + Math.sin(Date.now() / 100) * 0.3;
            ctx.fillStyle = ast.color;
            ctx.globalAlpha = pulse;
            ctx.fill();
            ctx.globalAlpha = 1.0;
         } else if (ast.hp < (ast.tier === AsteroidTier.TITAN ? 1000 : 50)) {
            ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(ast.radius/2, ast.radius/2); ctx.stroke(); ctx.globalAlpha = 1;
         }
      }
      ctx.restore();
    });

    // Ship
    const ship = shipRef.current;
    ctx.save(); ctx.translate(ship.x, ship.y); ctx.rotate(ship.angle);
    if (ship.invulnerableTimer > 0 && Math.floor(Date.now() / 100) % 2 === 0) ctx.globalAlpha = 0.5;
    if (ship.shield > 0) {
      ctx.strokeStyle = COLOR_SHIELD; ctx.shadowColor = COLOR_SHIELD; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(0, 0, SHIP_RADIUS + 8, 0, Math.PI * 2); ctx.stroke(); ctx.shadowBlur = 0;
    }

    ctx.fillStyle = '#1e293b'; ctx.strokeStyle = '#64748b'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-8, -5); ctx.lineTo(-16, 0); ctx.lineTo(-8, 5); ctx.closePath(); ctx.fill(); ctx.stroke();

    if (ship.thrusting) {
        ctx.fillStyle = '#06b6d4'; ctx.shadowColor = '#06b6d4'; ctx.shadowBlur = 15;
        ctx.beginPath(); ctx.moveTo(-14, -3); ctx.lineTo(-24 - Math.random()*5, 0); ctx.lineTo(-14, 3); ctx.fill(); ctx.shadowBlur = 0;
    }
    ctx.fillStyle = '#334155'; ctx.beginPath(); ctx.rect(-6, -12, 12, 4); ctx.rect(-6, 8, 12, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#475569'; ctx.beginPath(); ctx.rect(-8, -8, 16, 16); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#1e293b'; ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(0, 8); ctx.moveTo(-8, 0); ctx.lineTo(8, 0); ctx.stroke(); ctx.strokeStyle = '#64748b';
    ctx.fillStyle = '#64748b'; ctx.beginPath(); 
    ctx.moveTo(8, -7); ctx.lineTo(18, -7); ctx.lineTo(18, -3); ctx.lineTo(8, -3);
    ctx.moveTo(8, 7); ctx.lineTo(18, 7); ctx.lineTo(18, 3); ctx.lineTo(8, 3); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#0ea5e9'; ctx.shadowColor = '#0ea5e9'; ctx.shadowBlur = 5; ctx.beginPath(); ctx.rect(2, -3, 4, 6); ctx.fill(); ctx.shadowBlur = 0;
    ctx.fillStyle = '#facc15'; ctx.shadowColor = '#facc15'; ctx.shadowBlur = 8; ctx.beginPath();
    ctx.arc(16, -5, 1, 0, Math.PI*2); ctx.arc(16, 5, 1, 0, Math.PI*2);
    ctx.rect(-4, -11, 2, 2); ctx.rect(2, -11, 2, 2); ctx.rect(-4, 9, 2, 2); ctx.rect(2, 9, 2, 2); ctx.fill(); ctx.shadowBlur = 0;
    
    if (mouseRef.current.rightDown) {
       ctx.strokeStyle = 'rgba(74, 222, 128, 0.2)'; ctx.lineWidth = 1; ctx.beginPath();
       const pulse = 500 + Math.sin(Date.now() / 100) * 20; ctx.arc(0, 0, pulse, 0, Math.PI * 2); ctx.stroke();
       ctx.fillStyle = 'rgba(74, 222, 128, 0.05)'; ctx.fill();
    }
    ctx.restore();

    // Laser
    if (laserRef.current.active) {
       const { x, y, angle, length } = laserRef.current;
       const endX = x + Math.cos(angle) * length;
       const endY = y + Math.sin(angle) * length;
       const dist = length; const segments = Math.max(2, Math.floor(dist / 15));
       ctx.beginPath(); ctx.moveTo(x, y);
       for(let i=1; i < segments; i++) {
         const t = i / segments;
         const lx = x + (endX - x) * t; const ly = y + (endY - y) * t;
         const offset = (Math.random() - 0.5) * 12;
         const px = -Math.sin(angle) * offset; const py = Math.cos(angle) * offset;
         ctx.lineTo(lx + px, ly + py);
       }
       ctx.lineTo(endX, endY);
       ctx.lineWidth = 2; ctx.strokeStyle = '#ffffff'; ctx.stroke();
       ctx.lineWidth = 6; ctx.strokeStyle = COLOR_LASER; ctx.shadowColor = COLOR_LASER; ctx.shadowBlur = 15;
       ctx.globalCompositeOperation = 'screen'; ctx.stroke(); ctx.globalCompositeOperation = 'source-over'; ctx.shadowBlur = 0;
       if (length < LASER_RANGE - 5) {
          ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(endX, endY, 4 + Math.random() * 4, 0, Math.PI * 2); ctx.fill();
       }
    }
    ctx.restore();

    // Minimap
    const mapSize = 180; const mapPadding = 20; const mapX = mapPadding; const mapY = screenSize.height - mapSize - mapPadding; const mapScale = 0.025;
    ctx.save();
    ctx.translate(mapX, mapY); ctx.fillStyle = 'rgba(0, 20, 0, 0.8)'; ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 2;
    ctx.fillRect(0, 0, mapSize, mapSize); ctx.strokeRect(0, 0, mapSize, mapSize);
    ctx.beginPath(); ctx.rect(0, 0, mapSize, mapSize); ctx.clip();
    const mapCX = mapSize / 2; const mapCY = mapSize / 2;
    ctx.fillStyle = COLOR_STATION; ctx.beginPath(); ctx.arc(mapCX, mapCY, 4, 0, Math.PI * 2); ctx.fill();
    const shipMapX = mapCX + ship.x * mapScale; const shipMapY = mapCY + ship.y * mapScale;
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(shipMapX, shipMapY, 3, 0, Math.PI * 2); ctx.fill();

    asteroidsRef.current.forEach(ast => {
      const astX = mapCX + ast.x * mapScale; const astY = mapCY + ast.y * mapScale;
      if (astX > 0 && astX < mapSize && astY > 0 && astY < mapSize) {
        if (ast.tier === AsteroidTier.TITAN) ctx.fillStyle = COLOR_TITAN;
        else if (ast.tier === AsteroidTier.VOLATILE) ctx.fillStyle = COLOR_VOLATILE;
        else if (ast.tier === AsteroidTier.CHUNK) ctx.fillStyle = COLOR_CHUNK;
        else ctx.fillStyle = COLOR_ORE;
        
        // Blink volatiles
        if (ast.tier === AsteroidTier.VOLATILE && Math.floor(Date.now()/200)%2===0) {
            ctx.fillStyle = '#fff';
        }

        const r = Math.max(1, ast.radius * mapScale);
        ctx.beginPath(); ctx.arc(astX, astY, r, 0, Math.PI * 2); ctx.fill();
      }
    });

    minesRef.current.forEach(m => {
       const mx = mapCX + m.x * mapScale; const my = mapCY + m.y * mapScale;
       ctx.fillStyle = COLOR_DANGER; ctx.beginPath(); ctx.arc(mx, my, 2, 0, Math.PI * 2); ctx.fill();
       ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(mx, my, MINE_BLAST_RADIUS * mapScale, 0, Math.PI * 2); ctx.stroke();
    });
    ctx.fillStyle = 'rgba(74, 222, 128, 0.5)'; ctx.font = '10px monospace'; ctx.fillText('SECTOR RADAR', 5, 12);
    ctx.restore();

  }, [gameState, screenSize, shipRef]); // Reduced dependencies to fix strict mode flicker? Added basic ones.

  // --- Main Loop Effect ---
  
  useEffect(() => {
    let lastTime = 0;
    const loop = (time: number) => {
      const dt = time - lastTime;
      if (dt > 16) { 
         update();
         draw();
         lastTime = time;
      }
      requestRef.current = requestAnimationFrame(loop);
    };
    requestRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(requestRef.current);
  }, [update, draw]);

  // Handle Resize
  useEffect(() => {
    const handleResize = () => {
      setScreenSize({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // --- Input Listeners ---

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keysPressed.current.add(e.key.toLowerCase());
      if (e.code === 'Space' && gameState === GameState.PLAYING) {
        if (shipRef.current.ammo > 0) {
          shipRef.current.ammo--;
          minesRef.current.push({
             id: Math.random().toString(),
             x: shipRef.current.x, y: shipRef.current.y, vx: 0, vy: 0, radius: 10, angle: 0, color: COLOR_DANGER,
             timer: 180, state: 'ARMED'
          });
          audio.playMineArmed();
          syncUI();
        } else {
            audio.playUI('error');
        }
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => { keysPressed.current.delete(e.key.toLowerCase()); };
    const handleMouseMove = (e: MouseEvent) => { mouseRef.current.x = e.clientX; mouseRef.current.y = e.clientY; };
    const handleMouseDown = (e: MouseEvent) => { if (e.button === 0) mouseRef.current.down = true; if (e.button === 2) mouseRef.current.rightDown = true; };
    const handleMouseUp = (e: MouseEvent) => { if (e.button === 0) mouseRef.current.down = false; if (e.button === 2) mouseRef.current.rightDown = false; };
    const handleContextMenu = (e: MouseEvent) => { e.preventDefault(); };
    const handleWheel = (e: WheelEvent) => {
      if (gameState === GameState.PLAYING) {
        const delta = Math.sign(e.deltaY) * -0.1;
        const newZoom = Math.min(Math.max(cameraRef.current.zoom + delta, 0.4), 2.0);
        cameraRef.current.zoom = newZoom;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('wheel', handleWheel);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('wheel', handleWheel);
    };
  }, [gameState, syncUI, shipRef]);

  // Spawn / Reset Logic
  useEffect(() => {
    // Re-init on Game Start (from Menu or Game Over ONLY)
    if (gameState === GameState.PLAYING && (prevGameState.current === GameState.MENU || prevGameState.current === GameState.GAME_OVER)) {
        initGame();
    }
    // Re-init on Sector Change
    if (gameState === GameState.PLAYING && sector !== prevSector.current) {
        initGame();
        prevSector.current = sector;
    }
    prevGameState.current = gameState;
  }, [gameState, sector, initGame]);

  return <canvas ref={canvasRef} width={screenSize.width} height={screenSize.height} className="block cursor-crosshair" />;
};

export default GameCanvas;