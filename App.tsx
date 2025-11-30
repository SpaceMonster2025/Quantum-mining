import React, { useRef, useState, useCallback } from 'react';
import GameCanvas from './components/GameCanvas';
import UIOverlay from './components/UIOverlay';
import { GameState, Ship, Upgrades } from './types';
import { 
  STARTING_CREDITS, STARTING_AMMO, ORE_VALUE, UPGRADE_COST_BASE, UPGRADE_COST_MULTIPLIER 
} from './constants';
import { audio } from './utils/audio';

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>(GameState.MENU);
  const [sector, setSector] = useState(1);
  const [sectorStats, setSectorStats] = useState({ percent: 0, ore: 0 });
  
  // Game State Refs (Single source of truth passed to canvas)
  const shipRef = useRef<Ship>({
    id: 'hero', x: 0, y: 0, vx: 0, vy: 0, radius: 15, angle: -Math.PI/2, color: '#fff',
    thrusting: false, reversing: false, rotatingLeft: false, rotatingRight: false, firing: false,
    hull: 100, maxHull: 100, shield: 0, maxShield: 0,
    cargo: 0, maxCargo: 20, credits: STARTING_CREDITS, ammo: STARTING_AMMO, invulnerableTimer: 0
  });

  const upgradesRef = useRef<Upgrades>({
    engineLevel: 1,
    handlingLevel: 1,
    hullLevel: 1,
    cargoLevel: 1,
    laserLevel: 1,
    shieldLevel: 0
  });

  // Helper state to force UI re-renders without full game loop re-render
  const [uiVersion, setUiVersion] = useState(0);
  const syncUI = useCallback(() => setUiVersion(v => v + 1), []);

  const handleStartGame = () => {
    // Initialize Audio Engine on first user interaction
    audio.init();

    // Reset core stats if coming from menu/gameover
    if (gameState === GameState.GAME_OVER || gameState === GameState.MENU) {
       setSector(1);
       shipRef.current.credits = STARTING_CREDITS;
       shipRef.current.ammo = STARTING_AMMO;
       // Reset upgrades
       upgradesRef.current = {
          engineLevel: 1, handlingLevel: 1, hullLevel: 1, cargoLevel: 1, laserLevel: 1, shieldLevel: 0
       };
       // Recalculate derived stats
       recalcStats();
       
       // CRITICAL: Revive ship immediately so next game loop frame doesn't kill it again
       shipRef.current.hull = shipRef.current.maxHull; 
       shipRef.current.shield = shipRef.current.maxShield;
    }
    setGameState(GameState.PLAYING);
  };

  const handleSectorCleared = (stats: { percent: number; ore: number }) => {
    setSectorStats(stats);
    setGameState(GameState.SECTOR_CLEARED);
    audio.playUI('buy'); // Positive sound for progress
  };

  const handleNextSector = () => {
    setSector(s => s + 1);
    setGameState(GameState.PLAYING);
  };

  const handleUndock = () => {
    // Launch ship away from station to prevent immediate redocking loop
    // Apply enough velocity to exceed the docking threshold speed (< 1)
    const s = shipRef.current;
    const launchSpeed = 6; // Sufficient speed to clear station radius with friction
    s.vx = Math.cos(s.angle) * launchSpeed;
    s.vy = Math.sin(s.angle) * launchSpeed;
    
    setGameState(GameState.PLAYING);
  };

  const recalcStats = () => {
    const s = shipRef.current;
    const u = upgradesRef.current;
    s.maxHull = 100 + (u.hullLevel - 1) * 50;
    if (s.hull > s.maxHull) s.hull = s.maxHull;
    s.maxCargo = 20 + (u.cargoLevel - 1) * 20;
    s.maxShield = u.shieldLevel * 100; // 0 or 100 basically
    if (u.shieldLevel > 0 && s.shield < s.maxShield) s.shield = s.maxShield; // Recharge on dock/upgrade
  };

  // --- Shop Actions ---

  const handleSellOre = () => {
    const s = shipRef.current;
    if (s.cargo > 0) {
      s.credits += s.cargo * ORE_VALUE;
      s.cargo = 0;
      syncUI();
    }
  };

  const handleBuyAmmo = () => {
    const s = shipRef.current;
    if (s.credits >= 50) {
      s.credits -= 50;
      s.ammo += 1;
      syncUI();
    }
  };

  const handleRepair = () => {
    const s = shipRef.current;
    const cost = Math.floor((s.maxHull - s.hull) * 2);
    if (s.credits >= cost && s.hull < s.maxHull) {
      s.credits -= cost;
      s.hull = s.maxHull;
      syncUI();
    }
  };

  const handleUpgrade = (type: keyof Upgrades) => {
    const s = shipRef.current;
    const u = upgradesRef.current;
    const currentLevel = u[type];
    const cost = Math.floor(UPGRADE_COST_BASE * Math.pow(UPGRADE_COST_MULTIPLIER, currentLevel - 1));

    if (s.credits >= cost) {
      s.credits -= cost;
      u[type]++;
      recalcStats();
      // Heal hull if upgrading hull
      if (type === 'hullLevel') s.hull = s.maxHull;
      syncUI();
    }
  };

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden select-none">
      <GameCanvas 
        gameState={gameState} 
        setGameState={setGameState} 
        shipRef={shipRef}
        upgradesRef={upgradesRef}
        syncUI={syncUI}
        sector={sector}
        onSectorCleared={handleSectorCleared}
      />
      <UIOverlay 
        gameState={gameState}
        ship={shipRef.current}
        upgrades={upgradesRef.current}
        sector={sector}
        sectorStats={sectorStats}
        onStartGame={handleStartGame}
        onUndock={handleUndock}
        onSellOre={handleSellOre}
        onBuyAmmo={handleBuyAmmo}
        onRepair={handleRepair}
        onUpgrade={handleUpgrade}
        onNextSector={handleNextSector}
      />
    </div>
  );
};

export default App;