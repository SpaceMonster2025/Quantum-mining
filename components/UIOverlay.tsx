import React from 'react';
import { GameState, Ship, Upgrades } from '../types';
import { UPGRADE_COST_BASE, UPGRADE_COST_MULTIPLIER, ORE_VALUE } from '../constants';
import { audio } from '../utils/audio';

interface UIOverlayProps {
  gameState: GameState;
  ship: Ship;
  upgrades: Upgrades;
  onUpgrade: (type: keyof Upgrades) => void;
  onRepair: () => void;
  onBuyAmmo: () => void;
  onSellOre: () => void;
  onUndock: () => void;
  onStartGame: () => void;
}

const UIOverlay: React.FC<UIOverlayProps> = ({ 
  gameState, ship, upgrades, onUpgrade, onRepair, onBuyAmmo, onSellOre, onUndock, onStartGame 
}) => {
  
  const getCost = (level: number) => Math.floor(UPGRADE_COST_BASE * Math.pow(UPGRADE_COST_MULTIPLIER, level - 1));
  const repairCost = Math.floor((ship.maxHull - ship.hull) * 2);
  const ammoCost = 50;

  const playClick = () => audio.playUI('click');
  const playBuy = () => audio.playUI('buy');
  const playError = () => audio.playUI('error');

  // Render HUD
  if (gameState === GameState.PLAYING) {
    return (
      <div className="absolute inset-0 pointer-events-none p-4 flex flex-col justify-between">
        {/* Top Bar */}
        <div className="flex justify-between items-start">
          <div className="space-y-2">
            {/* Hull */}
            <div className="w-64 bg-slate-800 border border-slate-600 h-6 relative">
              <div 
                className={`h-full ${ship.hull < 30 ? 'bg-red-500 animate-pulse' : 'bg-green-500'}`} 
                style={{ width: `${(ship.hull / ship.maxHull) * 100}%` }}
              />
              <span className="absolute inset-0 flex items-center justify-center text-xs font-bold drop-shadow-md">
                HULL: {Math.floor(ship.hull)}/{ship.maxHull}
              </span>
            </div>
            {/* Shield */}
            {ship.maxShield > 0 && (
              <div className="w-64 bg-slate-800 border border-blue-900 h-4 relative">
                <div 
                  className="h-full bg-blue-500" 
                  style={{ width: `${(ship.shield / ship.maxShield) * 100}%` }}
                />
                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold drop-shadow-md">
                  SHIELD
                </span>
              </div>
            )}
          </div>
          
          <div className="text-right">
             <div className="text-yellow-400 text-xl font-bold font-mono tracking-wider">
               CR: {ship.credits}
             </div>
             <div className={`text-lg font-mono ${ship.cargo >= ship.maxCargo ? 'text-red-500 animate-bounce' : 'text-green-400'}`}>
               CARGO: {ship.cargo} / {ship.maxCargo}
             </div>
          </div>
        </div>

        {/* Center Warnings */}
        {ship.cargo >= ship.maxCargo && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 text-red-500 font-bold border border-red-500 px-4 py-1 bg-black/50">
            CARGO FULL - RETURN TO STATION
          </div>
        )}

        {/* Bottom Right Ammo */}
        <div className="flex justify-end">
           <div className="text-right">
              <div className="text-red-500 font-bold text-2xl tracking-widest">
                Q-CHARGES
              </div>
              <div className="flex justify-end gap-1 mt-1">
                {Array.from({length: Math.min(ship.ammo, 10)}).map((_, i) => (
                  <div key={i} className="w-4 h-6 bg-red-500 border border-red-900"></div>
                ))}
                <span className="ml-2 text-xl">{ship.ammo}</span>
              </div>
           </div>
        </div>
      </div>
    );
  }

  // Render Docking Menu
  if (gameState === GameState.DOCKED) {
    return (
      <div className="absolute inset-0 bg-black/80 flex items-center justify-center pointer-events-auto">
        <div className="bg-slate-900 border-2 border-yellow-500 p-8 max-w-4xl w-full grid grid-cols-2 gap-8 shadow-2xl shadow-yellow-500/20">
          
          {/* Header */}
          <div className="col-span-2 flex justify-between items-center border-b border-slate-700 pb-4">
             <h1 className="text-3xl font-bold text-yellow-500">STATION SERVICES</h1>
             <div className="text-2xl text-green-400 font-mono">CREDITS: {ship.credits}</div>
          </div>

          {/* Left Column: Actions */}
          <div className="space-y-6">
            <h2 className="text-xl font-bold text-white">MAINTENANCE</h2>
            
            <button 
              onClick={() => { playBuy(); onSellOre(); }}
              disabled={ship.cargo === 0}
              className="w-full p-4 bg-green-900/50 border border-green-500 text-green-400 hover:bg-green-900 transition flex justify-between items-center disabled:opacity-50"
            >
              <span>SELL ORE ({ship.cargo})</span>
              <span>+{ship.cargo * ORE_VALUE} CR</span>
            </button>

            <button 
              onClick={() => { playBuy(); onRepair(); }}
              disabled={ship.hull >= ship.maxHull || ship.credits < repairCost}
              className="w-full p-4 bg-blue-900/50 border border-blue-500 text-blue-400 hover:bg-blue-900 transition flex justify-between items-center disabled:opacity-50"
            >
              <span>REPAIR HULL</span>
              <span>-{repairCost} CR</span>
            </button>

            <button 
              onClick={() => { playBuy(); onBuyAmmo(); }}
              disabled={ship.credits < ammoCost}
              className="w-full p-4 bg-red-900/50 border border-red-500 text-red-400 hover:bg-red-900 transition flex justify-between items-center disabled:opacity-50"
            >
              <span>BUY Q-CHARGE</span>
              <span>-{ammoCost} CR</span>
            </button>
            
            <div className="pt-8">
              <button 
                onClick={() => { playClick(); onUndock(); }}
                className="w-full py-6 text-xl font-bold bg-yellow-600 hover:bg-yellow-500 text-black uppercase tracking-widest clip-corner"
              >
                UNDOCK & LAUNCH
              </button>
            </div>
          </div>

          {/* Right Column: Upgrades */}
          <div className="space-y-4 max-h-[500px] overflow-y-auto">
             <h2 className="text-xl font-bold text-white">SHIP UPGRADES</h2>
             
             {[
               { id: 'engineLevel', name: 'Engine Output', desc: 'Speed & Acceleration', lvl: upgrades.engineLevel },
               { id: 'handlingLevel', name: 'Thruster Control', desc: 'Rotation Speed', lvl: upgrades.handlingLevel },
               { id: 'hullLevel', name: 'Titanium Hull', desc: 'Max Health', lvl: upgrades.hullLevel },
               { id: 'cargoLevel', name: 'Cargo Bay', desc: 'Ore Capacity', lvl: upgrades.cargoLevel },
               { id: 'laserLevel', name: 'Mining Laser', desc: 'Mining Speed', lvl: upgrades.laserLevel },
               { id: 'shieldLevel', name: 'Deflector Shield', desc: 'Absorbs 1 Hit', lvl: upgrades.shieldLevel },
             ].map((u) => {
               const cost = getCost(u.lvl);
               const canAfford = ship.credits >= cost;
               return (
                 <div key={u.id} className="border border-slate-700 p-3 bg-slate-800">
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-bold text-cyan-400">{u.name} <span className="text-xs text-slate-400">LVL {u.lvl}</span></span>
                      <span className="text-yellow-500">{cost} CR</span>
                    </div>
                    <div className="text-xs text-slate-400 mb-2">{u.desc}</div>
                    <button 
                      onClick={() => { canAfford ? playBuy() : playError(); onUpgrade(u.id as keyof Upgrades); }}
                      disabled={!canAfford}
                      className="w-full py-1 bg-slate-700 hover:bg-cyan-700 disabled:opacity-30 disabled:hover:bg-slate-700 text-xs uppercase"
                    >
                      {canAfford ? 'UPGRADE' : 'INSUFFICIENT FUNDS'}
                    </button>
                 </div>
               );
             })}
          </div>
        </div>
      </div>
    );
  }

  // Menu or Game Over
  return (
    <div className="absolute inset-0 bg-black flex flex-col items-center justify-center pointer-events-auto">
      <div className="text-center space-y-8">
         <h1 className="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-cyan-400 tracking-tighter">
           QUANTUM<br/>FRAGMENTATION
         </h1>
         
         {gameState === GameState.GAME_OVER && (
           <div className="text-red-500 text-2xl font-mono border border-red-500 p-4">
             CRITICAL HULL FAILURE. SIGNAL LOST.
           </div>
         )}

         <div className="max-w-md text-left text-slate-400 text-sm space-y-2 border-l-2 border-purple-500 pl-4">
            <p>1. Find <span className="text-slate-200">Titan Asteroids</span> (Massive).</p>
            <p>2. Plant <span className="text-red-400">Quantum Charge</span> [SPACE].</p>
            <p>3. ESCAPE the <span className="text-red-400">Blast Zone</span>.</p>
            <p>4. Mine <span className="text-green-400">Ore</span> with Laser [MOUSE].</p>
            <p>5. Return to <span className="text-yellow-400">Station</span> to sell & upgrade.</p>
         </div>

         <button 
           onClick={() => { playClick(); onStartGame(); }}
           className="px-12 py-4 bg-purple-600 hover:bg-purple-500 text-white font-bold text-xl rounded-none border-2 border-purple-400 shadow-[0_0_20px_rgba(168,85,247,0.5)] transition"
         >
           {gameState === GameState.GAME_OVER ? 'REBOOT SYSTEM' : 'INITIATE LAUNCH SEQUENCE'}
         </button>
      </div>
    </div>
  );
};

export default UIOverlay;