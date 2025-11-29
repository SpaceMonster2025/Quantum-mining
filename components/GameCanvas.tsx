import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Asteroid, AsteroidTier, GameState, Mine, Particle, Ship, Upgrades } from '../types';
import { 
  FRICTION, SHIP_ACCEL, SHIP_ROTATION_SPEED, 
  MAX_SPEED, LASER_RANGE, SHIP_RADIUS, MINE_PUCKER_DURATION, MINE_BLAST_RADIUS,
  COLOR_ORE, COLOR_TITAN, COLOR_CHUNK, COLOR_DANGER, COLOR_SHIP, COLOR_THRUST,
  STATION_RADIUS, COLOR_STATION, COLOR_SHIELD, MINE_PUCKER_FORCE, MINE_BLAST_FORCE,
  TITAN_RADIUS, CHUNK_RADIUS, ORE_RADIUS, UPGRADE_COST_BASE, UPGRADE_COST_MULTIPLIER,
  COLOR_LASER
} from '../constants';
import { distance, randomRange, checkCollision, generatePolygonOffsets } from '../utils/physics';

interface GameCanvasProps {
  gameState: GameState;
  setGameState: (state: GameState) => void;
  shipRef: React.MutableRefObject<Ship>;
  upgradesRef: React.MutableRefObject<Upgrades>;
  syncUI: () => void;
}

const GameCanvas: React.FC<GameCanvasProps> = ({ gameState, setGameState, shipRef, upgradesRef, syncUI }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(0);
  const prevGameState = useRef<GameState>(gameState);
  
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
  
  // Laser State for separation of logic/render
  const laserRef = useRef({ active: false, x: 0, y: 0, length: 0, angle: 0 });

  // --- Initialization ---

  const spawnAsteroid = (tier: AsteroidTier, x: number, y: number, vx: number, vy: number) => {
    const size = tier === AsteroidTier.TITAN ? TITAN_RADIUS : (tier === AsteroidTier.CHUNK ? CHUNK_RADIUS : ORE_RADIUS);
    const hp = tier === AsteroidTier.TITAN ? 1000 : (tier === AsteroidTier.CHUNK ? 50 : 1);
    
    asteroidsRef.current.push({
      id: Math.random().toString(36).substr(2, 9),
      x, y, vx, vy,
      radius: size,
      angle: Math.random() * Math.PI * 2,
      color: tier === AsteroidTier.TITAN ? COLOR_TITAN : (tier === AsteroidTier.CHUNK ? COLOR_CHUNK : COLOR_ORE),
      tier,
      hp,
      rotationSpeed: randomRange(-0.02, 0.02),
      shape: generatePolygonOffsets(tier === AsteroidTier.TITAN ? 12 : 8, 0.2)
    });
  };

  // Helper to handle asteroid destruction logic
  const breakAsteroid = (ast: Asteroid, impactVx: number, impactVy: number) => {
    // Visual Dust
    spawnParticles(ast.x, ast.y, ast.color, 8, 2, 25);

    if (ast.tier === AsteroidTier.TITAN) {
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
      // Chunk -> Ore
      const oreCount = 25; // 5x Loot: Increased from 5 to 25
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
    // Reset Ship
    shipRef.current = {
      ...shipRef.current,
      x: 0, y: 0, vx: 0, vy: -4, angle: -Math.PI / 2, // Launch upwards with velocity to avoid instant dock
      hull: shipRef.current.maxHull,
      shield: shipRef.current.maxShield,
      cargo: 0,
      invulnerableTimer: 0
    };
    
    asteroidsRef.current = [];
    minesRef.current = [];
    particlesRef.current = [];
    cameraRef.current.zoom = 0.8;
    shakeRef.current = 0;

    // Spawn Field
    for (let i = 0; i < 20; i++) {
      const dist = randomRange(500, 3000);
      const theta = Math.random() * Math.PI * 2;
      spawnAsteroid(
        AsteroidTier.TITAN,
        Math.cos(theta) * dist,
        Math.sin(theta) * dist,
        randomRange(-0.5, 0.5),
        randomRange(-0.5, 0.5)
      );
    }
  }, [shipRef]);

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
    if (gameState !== GameState.PLAYING) return;

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
      // Thruster particles
      spawnParticles(
        ship.x - Math.cos(ship.angle) * 15, 
        ship.y - Math.sin(ship.angle) * 15, 
        COLOR_THRUST, 1, 1, 15
      );
    } else {
      ship.thrusting = false;
    }

    if (keysPressed.current.has('s') || keysPressed.current.has('arrowdown')) {
      ship.vx *= 0.95;
      ship.vy *= 0.95;
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
    // To keep ship centered:
    // ScreenCenter = (ShipPos - CameraPos) * Zoom
    // CameraPos = ShipPos - (ScreenCenter / Zoom)
    const zoom = cameraRef.current.zoom;
    cameraRef.current.x = ship.x - (screenSize.width / 2) / zoom;
    cameraRef.current.y = ship.y - (screenSize.height / 2) / zoom;

    // 3. Mining Laser Logic
    laserRef.current.active = false;
    if (mouseRef.current.down) {
      const centerX = screenSize.width / 2;
      const centerY = screenSize.height / 2;
      const dx = mouseRef.current.x - centerX;
      const dy = mouseRef.current.y - centerY;
      const aimAngle = Math.atan2(dy, dx);
      
      // Default to max range
      laserRef.current = {
          active: true,
          x: ship.x,
          y: ship.y,
          angle: aimAngle,
          length: LASER_RANGE
      };
      
      let closestAst: Asteroid | null = null;
      let closestDist = LASER_RANGE; // Start with max range
      const laserPower = 1 + (upgrades.laserLevel * 0.5);

      asteroidsRef.current.forEach(ast => {
        // Ignore Titans (needs bombs) and Ore (indestructible/loot)
        if (ast.tier === AsteroidTier.TITAN || ast.tier === AsteroidTier.ORE) return;

        const dToAst = distance({x: ship.x, y: ship.y}, ast);
        
        // Broad check first (range + radius)
        if (dToAst < LASER_RANGE + ast.radius) {
          const angleToAst = Math.atan2(ast.y - ship.y, ast.x - ship.x);
          let angleDiff = angleToAst - aimAngle;
          while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
          while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

          // Cone check (approx 22 degrees total width)
          if (Math.abs(angleDiff) < 0.2) {
             // We want the CLOSEST asteroid
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
         
         // Visuals: Stop laser at surface (approximate with radius)
         const impactDist = Math.max(0, closestDist - ast.radius);
         laserRef.current.length = impactDist;
         
         const impactX = ship.x + Math.cos(aimAngle) * impactDist;
         const impactY = ship.y + Math.sin(aimAngle) * impactDist;

         spawnParticles(impactX, impactY, COLOR_ORE, 2, 2, 10);
         
         if (wasAlive && ast.hp <= 0) {
           breakAsteroid(ast, 0, 0); 
         }
      }

      asteroidsRef.current = asteroidsRef.current.filter(a => a.hp > 0);
    }

    // 4. Tractor Beam (Right Mouse)
    if (mouseRef.current.rightDown) {
      const TRACTOR_RANGE = 500;
      const TRACTOR_FORCE = 0.5;

      asteroidsRef.current.forEach(ast => {
        if (ast.tier === AsteroidTier.ORE) {
          const dist = distance(ship, ast);
          if (dist < TRACTOR_RANGE) {
            const angle = Math.atan2(ship.y - ast.y, ship.x - ast.x);
            // Apply suction force
            ast.vx += Math.cos(angle) * TRACTOR_FORCE;
            ast.vy += Math.sin(angle) * TRACTOR_FORCE;
            
            // Subtle random wiggle to make it look like a magnetic field
            ast.vx += randomRange(-0.2, 0.2);
            ast.vy += randomRange(-0.2, 0.2);
          }
        }
      });
    }

    // 5. Mines
    minesRef.current.forEach(mine => {
      mine.timer--;
      
      if (mine.timer > 0 && mine.timer < MINE_PUCKER_DURATION) {
        mine.state = 'PUCKER';
        // Physics Pull
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

        // VISUAL: Implosion Particles (Suction)
        // Spawn particles at blast radius moving INWARD
        for(let i=0; i<3; i++) {
           const angle = Math.random() * Math.PI * 2;
           const dist = MINE_BLAST_RADIUS * (0.8 + Math.random() * 0.4);
           const px = mine.x + Math.cos(angle) * dist;
           const py = mine.y + Math.sin(angle) * dist;
           const speed = randomRange(3, 6);
           particlesRef.current.push({
               id: Math.random().toString(),
               x: px, y: py,
               vx: -Math.cos(angle) * speed, // Move Inwards
               vy: -Math.sin(angle) * speed,
               radius: randomRange(1, 2),
               color: Math.random() > 0.5 ? '#ffffff' : COLOR_DANGER,
               angle: 0,
               life: 30,
               maxLife: 30,
               decay: 1
           });
        }

      } else if (mine.timer <= 0) {
        mine.state = 'DETONATING';
        
        // TRIGGER SCREEN SHAKE
        shakeRef.current = 25;

        // VISUAL: Massive Explosion
        // 1. Fast Sparks (Fire)
        spawnParticles(mine.x, mine.y, COLOR_DANGER, 60, 15, 45);
        spawnParticles(mine.x, mine.y, '#fbbf24', 40, 12, 40); // Amber
        spawnParticles(mine.x, mine.y, '#ffffff', 20, 18, 25); // White center

        // 2. Heavy Dust/Debris (Implosion Remnants)
        // Slower, larger, grey particles
        for(let i=0; i<50; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = randomRange(2, 6);
          particlesRef.current.push({
             id: Math.random().toString(),
             x: mine.x, y: mine.y,
             vx: Math.cos(angle) * speed,
             vy: Math.sin(angle) * speed,
             radius: randomRange(3, 8),
             color: '#475569', // Slate 600 (Dust)
             angle: 0,
             life: randomRange(60, 120), // Long life
             maxLife: 120,
             decay: 1
          });
        }
        
        asteroidsRef.current.forEach(ast => {
          const d = distance(mine, ast);
          if (d < MINE_BLAST_RADIUS) {
            const angle = Math.atan2(ast.y - mine.y, ast.x - mine.x);
            const force = MINE_BLAST_FORCE * (1 - d/MINE_BLAST_RADIUS);
            
            // Apply impulse
            ast.vx += Math.cos(angle) * force;
            ast.vy += Math.sin(angle) * force;

            const wasAlive = ast.hp > 0;
            if (ast.tier === AsteroidTier.TITAN) {
               ast.hp = 0;
            } else if (ast.tier !== AsteroidTier.ORE) { // Ore is indestructible to blasts
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


    // 6. Asteroid Physics & Collision
    asteroidsRef.current.forEach(ast => {
      ast.x += ast.vx;
      ast.y += ast.vy;
      ast.angle += ast.rotationSpeed;
      ast.vx *= 0.99;
      ast.vy *= 0.99;

      if (checkCollision(ship, ast)) {
        if (ast.tier === AsteroidTier.ORE) {
          if (ship.cargo < ship.maxCargo) {
            ship.cargo++;
            ast.hp = 0;
            syncUI();
          }
        } else {
          if (ship.invulnerableTimer <= 0) {
             const vRel = Math.sqrt(Math.pow(ship.vx - ast.vx, 2) + Math.pow(ship.vy - ast.vy, 2));
             if (vRel > 2) {
               shakeRef.current = 5; // Small shake on impact
               if (ship.shield > 0) {
                  ship.shield = 0;
               } else {
                  const damage = ast.tier === AsteroidTier.TITAN ? 100 : 20;
                  ship.hull -= damage;
               }
               ship.invulnerableTimer = 60;
               const angle = Math.atan2(ship.y - ast.y, ship.x - ast.x);
               ship.vx += Math.cos(angle) * 5;
               ship.vy += Math.sin(angle) * 5;
               syncUI();
             }
          }
        }
      }
    });

    // 7. Station Docking
    const distToStation = distance({x:0, y:0}, ship);
    if (distToStation < STATION_RADIUS + SHIP_RADIUS && Math.abs(ship.vx) < 1 && Math.abs(ship.vy) < 1) {
       setGameState(GameState.DOCKED);
    }

    // 8. Particles
    particlesRef.current.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.life--;
    });
    particlesRef.current = particlesRef.current.filter(p => p.life > 0);

    // 9. Timers
    if (ship.invulnerableTimer > 0) ship.invulnerableTimer--;

    // 10. Game Over Check
    if (ship.hull <= 0) {
      setGameState(GameState.GAME_OVER);
    }

  }, [gameState, setGameState, syncUI, shipRef, upgradesRef, screenSize]);

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
    
    // Apply Camera & Zoom & Shake
    ctx.scale(zoom, zoom);
    
    // Calculate Shake Offset
    const shakeX = (Math.random() - 0.5) * shake;
    const shakeY = (Math.random() - 0.5) * shake;

    ctx.translate(
        -cameraRef.current.x + shakeX, 
        -cameraRef.current.y + shakeY
    );

    // Draw Grid (World Reference) - Adjusted for Viewport bounds in world space
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const gridSize = 200;
    
    // Calculate visible world bounds
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

    // Draw Station
    ctx.shadowBlur = 20;
    ctx.shadowColor = COLOR_STATION;
    ctx.strokeStyle = COLOR_STATION;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, STATION_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    
    ctx.font = '20px monospace';
    ctx.fillStyle = COLOR_STATION;
    ctx.textAlign = 'center';
    ctx.fillText('STATION HUB', 0, 0);

    // Draw Particles
    particlesRef.current.forEach(p => {
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.shadowBlur = 5;
      ctx.shadowColor = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1.0;

    // Draw Mines
    minesRef.current.forEach(m => {
      ctx.shadowBlur = 15;
      ctx.shadowColor = COLOR_DANGER;
      ctx.fillStyle = COLOR_DANGER;
      
      let radius = 10;
      if (m.state === 'PUCKER') {
        radius = 5 + Math.random() * 2;
        ctx.strokeStyle = COLOR_DANGER;
        ctx.beginPath();
        for(let i=0; i<4; i++) {
           const a = (Date.now() / 100) + (i * Math.PI / 2);
           ctx.moveTo(m.x + Math.cos(a)*50, m.y + Math.sin(a)*50);
           ctx.lineTo(m.x, m.y);
        }
        ctx.stroke();
      } else if (Math.floor(Date.now() / 200) % 2 === 0) {
        ctx.fillStyle = '#fff';
      }

      ctx.beginPath();
      ctx.arc(m.x, m.y, radius, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.2)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.arc(m.x, m.y, MINE_BLAST_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // Draw Asteroids
    asteroidsRef.current.forEach(ast => {
      ctx.save();
      ctx.translate(ast.x, ast.y);
      ctx.rotate(ast.angle);
      
      ctx.shadowBlur = ast.tier === AsteroidTier.ORE ? 10 : 0;
      ctx.shadowColor = ast.color;
      ctx.strokeStyle = ast.color;
      ctx.fillStyle = ast.tier === AsteroidTier.ORE ? ast.color : 'transparent';
      ctx.lineWidth = 2;

      ctx.beginPath();
      if (ast.tier === AsteroidTier.ORE) {
         ctx.arc(0, 0, ast.radius, 0, Math.PI * 2);
         ctx.fill();
      } else {
         const sides = ast.shape.length;
         const angleStep = (Math.PI * 2) / sides;
         ctx.moveTo(ast.radius * ast.shape[0], 0);
         for(let i=1; i<sides; i++) {
           ctx.lineTo(
             Math.cos(i * angleStep) * ast.radius * ast.shape[i],
             Math.sin(i * angleStep) * ast.radius * ast.shape[i]
           );
         }
         ctx.closePath();
         ctx.stroke();
         
         if (ast.hp < (ast.tier === AsteroidTier.TITAN ? 1000 : 50)) {
            ctx.globalAlpha = 0.5;
            ctx.beginPath();
            ctx.moveTo(0,0);
            ctx.lineTo(ast.radius/2, ast.radius/2);
            ctx.stroke();
            ctx.globalAlpha = 1;
         }
      }
      ctx.restore();
    });

    // Draw Ship
    const ship = shipRef.current;
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.angle);

    if (ship.invulnerableTimer > 0 && Math.floor(Date.now() / 100) % 2 === 0) {
       ctx.globalAlpha = 0.5;
    }

    if (ship.shield > 0) {
      ctx.strokeStyle = COLOR_SHIELD;
      ctx.shadowColor = COLOR_SHIELD;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(0, 0, SHIP_RADIUS + 5, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.shadowBlur = 10;
    ctx.shadowColor = COLOR_SHIP;
    ctx.strokeStyle = COLOR_SHIP;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(15, 0); 
    ctx.lineTo(-10, 10);
    ctx.lineTo(-5, 0);
    ctx.lineTo(-10, -10);
    ctx.closePath();
    ctx.stroke();
    
    // Draw Tractor Beam Effect
    if (mouseRef.current.rightDown) {
       ctx.strokeStyle = 'rgba(74, 222, 128, 0.2)'; // Green tint
       ctx.lineWidth = 1;
       ctx.beginPath();
       const pulse = 500 + Math.sin(Date.now() / 100) * 20;
       ctx.arc(0, 0, pulse, 0, Math.PI * 2);
       ctx.stroke();
       
       ctx.fillStyle = 'rgba(74, 222, 128, 0.05)';
       ctx.fill();
    }
    
    ctx.restore(); // Restore from Ship Space

    // Draw Laser (Lightning Effect)
    if (laserRef.current.active) {
       const { x, y, angle, length } = laserRef.current;
       const endX = x + Math.cos(angle) * length;
       const endY = y + Math.sin(angle) * length;
       
       const dist = length;
       const segments = Math.max(2, Math.floor(dist / 15));
       
       ctx.beginPath();
       ctx.moveTo(x, y);

       for(let i=1; i < segments; i++) {
         const t = i / segments;
         const lx = x + (endX - x) * t;
         const ly = y + (endY - y) * t;
         // Jitter
         const offset = (Math.random() - 0.5) * 12;
         // Perpendicular vector
         const px = -Math.sin(angle) * offset;
         const py = Math.cos(angle) * offset;
         
         ctx.lineTo(lx + px, ly + py);
       }
       ctx.lineTo(endX, endY);
       
       // Inner Core
       ctx.lineWidth = 2;
       ctx.strokeStyle = '#ffffff';
       ctx.stroke();
       
       // Outer Glow
       ctx.lineWidth = 6;
       ctx.strokeStyle = COLOR_LASER;
       ctx.shadowColor = COLOR_LASER;
       ctx.shadowBlur = 15;
       ctx.globalCompositeOperation = 'screen';
       ctx.stroke();
       ctx.globalCompositeOperation = 'source-over';
       ctx.shadowBlur = 0;

       // Spark at collision point if length < MAX (hitting something)
       if (length < LASER_RANGE - 5) {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(endX, endY, 4 + Math.random() * 4, 0, Math.PI * 2);
          ctx.fill();
       }
    }

    ctx.restore(); // End Camera Transform

    // --- DRAW MINIMAP / RADAR ---
    // Bottom Left
    const mapSize = 180;
    const mapPadding = 20;
    const mapX = mapPadding;
    const mapY = screenSize.height - mapSize - mapPadding;
    const mapScale = 0.025; // Shows ~7200 world units width

    ctx.save();
    
    // Map Background
    ctx.translate(mapX, mapY);
    ctx.fillStyle = 'rgba(0, 20, 0, 0.8)';
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 2;
    ctx.fillRect(0, 0, mapSize, mapSize);
    ctx.strokeRect(0, 0, mapSize, mapSize);

    // Clip to map area
    ctx.beginPath();
    ctx.rect(0, 0, mapSize, mapSize);
    ctx.clip();

    // Map Center (Relative to 0,0 in world)
    // We want the map to be fixed centered on 0,0 (Station) to show the "Sector"
    const centerX = mapSize / 2;
    const centerY = mapSize / 2;

    // Draw Station (Fixed at 0,0)
    ctx.fillStyle = COLOR_STATION;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 4, 0, Math.PI * 2);
    ctx.fill();

    // Draw Ship
    const shipMapX = centerX + ship.x * mapScale;
    const shipMapY = centerY + ship.y * mapScale;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(shipMapX, shipMapY, 3, 0, Math.PI * 2);
    ctx.fill();

    // Draw Asteroids
    asteroidsRef.current.forEach(ast => {
      const astX = centerX + ast.x * mapScale;
      const astY = centerY + ast.y * mapScale;
      
      // Optimization: Only draw if within map bounds
      if (astX > 0 && astX < mapSize && astY > 0 && astY < mapSize) {
        ctx.fillStyle = ast.tier === AsteroidTier.TITAN ? COLOR_TITAN : (ast.tier === AsteroidTier.CHUNK ? COLOR_CHUNK : COLOR_ORE);
        const r = Math.max(1, ast.radius * mapScale);
        ctx.beginPath();
        ctx.arc(astX, astY, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // Draw Mines
    minesRef.current.forEach(m => {
       const mx = centerX + m.x * mapScale;
       const my = centerY + m.y * mapScale;
       ctx.fillStyle = COLOR_DANGER;
       ctx.beginPath();
       ctx.arc(mx, my, 2, 0, Math.PI * 2);
       ctx.fill();
       // Blast radius ring
       ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)';
       ctx.lineWidth = 1;
       ctx.beginPath();
       ctx.arc(mx, my, MINE_BLAST_RADIUS * mapScale, 0, Math.PI * 2);
       ctx.stroke();
    });

    // Label
    ctx.fillStyle = 'rgba(74, 222, 128, 0.5)';
    ctx.font = '10px monospace';
    ctx.fillText('SECTOR RADAR', 5, 12);

    ctx.restore();


  }, [gameState, screenSize]);

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
          // Drop Mine
          shipRef.current.ammo--;
          minesRef.current.push({
             id: Math.random().toString(),
             x: shipRef.current.x,
             y: shipRef.current.y,
             vx: 0, vy: 0, radius: 10, angle: 0, color: COLOR_DANGER,
             timer: 180, // ~3 seconds at 60fps
             state: 'ARMED'
          });
          syncUI();
        }
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      keysPressed.current.delete(e.key.toLowerCase());
    };
    
    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current.x = e.clientX;
      mouseRef.current.y = e.clientY;
    };
    const handleMouseDown = (e: MouseEvent) => { 
      if (e.button === 0) mouseRef.current.down = true; 
      if (e.button === 2) mouseRef.current.rightDown = true;
    };
    const handleMouseUp = (e: MouseEvent) => { 
      if (e.button === 0) mouseRef.current.down = false; 
      if (e.button === 2) mouseRef.current.rightDown = false;
    };
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    
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

  // Initial Spawn Logic
  useEffect(() => {
    if (gameState === GameState.PLAYING) {
      if (prevGameState.current === GameState.MENU || prevGameState.current === GameState.GAME_OVER) {
         initGame();
      } 
      else if (asteroidsRef.current.length === 0) {
        initGame();
      }
    }
    prevGameState.current = gameState;
  }, [gameState, initGame]);

  return <canvas ref={canvasRef} width={screenSize.width} height={screenSize.height} className="block cursor-crosshair" />;
};

export default GameCanvas;