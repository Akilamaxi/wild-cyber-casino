import React, { useState, useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';
import { io } from 'socket.io-client';
import CrashPlayersTable from './CrashPlayersTable';
import CrashHistoryTable from './CrashHistoryTable';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';

function BettingPanel({ id, state, setState, onBet, onCashOut, gameState, currentUser }) {
  const { betAmount, isBetPlaced, isCashedOut, winnings } = state;

  return (
    <div style={{ background: '#0a0d10', padding: '20px', borderRadius: '16px', border: '1px solid #1a1e23', flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px', color: '#6b7280', fontSize: '14px' }}>
        <span>Wager Amount</span>
        <span>${currentUser.balance.toFixed(2)}</span>
      </div>
      
      <div style={{ display: 'flex', background: '#12161b', borderRadius: '8px', border: '1px solid #1a1e23', padding: '5px' }}>
        <span style={{ padding: '10px', color: '#ffaa00' }}>$</span>
        <input 
          type="number" 
          value={betAmount} 
          onChange={e => setState({ ...state, betAmount: parseFloat(e.target.value) || 0 })}
          disabled={gameState !== 'BETTING' || isBetPlaced}
          style={{ width: '100%', background: 'transparent', color: '#fff', border: 'none', fontSize: '1.2rem', outline: 'none', textAlign: 'right', paddingRight: '10px' }}
        />
      </div>

      <div style={{ display: 'flex', gap: '5px', marginTop: '10px' }}>
        {[10, 50, 100, 500].map(amt => (
          <button 
            key={amt} 
            onClick={() => setState({ ...state, betAmount: amt })}
            disabled={gameState !== 'BETTING' || isBetPlaced}
            style={{ flex: 1, background: '#12161b', color: '#6b7280', border: '1px solid #1a1e23', borderRadius: '4px', padding: '8px 0', cursor: 'pointer', transition: 'all 0.2s' }}
          >
            +{amt}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 'auto', paddingTop: '20px' }}>
        {gameState === 'BETTING' && !isBetPlaced && (
          <button onClick={() => onBet(id)} style={{ width: '100%', padding: '18px', fontSize: '1.1rem', background: '#ffaa00', color: '#000', fontWeight: 'bold', border: 'none', borderRadius: '8px', cursor: 'pointer', boxShadow: '0 4px 15px rgba(255, 170, 0, 0.2)' }}>
            BET
          </button>
        )}

        {gameState === 'BETTING' && isBetPlaced && (
          <button disabled style={{ width: '100%', padding: '18px', fontSize: '1.1rem', background: 'rgba(255, 170, 0, 0.2)', color: '#ffaa00', fontWeight: 'bold', border: '1px solid #ffaa00', borderRadius: '8px' }}>
            WAITING FOR FLIGHT...
          </button>
        )}

        {gameState === 'FLIGHT' && isBetPlaced && !isCashedOut && (
          <button onClick={() => onCashOut(id)} style={{ width: '100%', padding: '18px', fontSize: '1.2rem', background: '#00ff66', color: '#000', fontWeight: '900', border: 'none', borderRadius: '8px', cursor: 'pointer', boxShadow: '0 0 20px rgba(0,255,102,0.4)' }}>
            CASH OUT
          </button>
        )}

        {gameState === 'FLIGHT' && isCashedOut && (
          <div style={{ textAlign: 'center', background: 'rgba(0, 255, 102, 0.1)', color: '#00ff66', fontWeight: 'bold', padding: '15px', border: '1px solid #00ff66', borderRadius: '8px' }}>
            CASHED OUT<br/>
            <span style={{ fontSize: '1.2rem' }}>+${winnings?.toFixed(2)}</span>
          </div>
        )}

        {gameState === 'FLIGHT' && !isBetPlaced && (
          <button disabled style={{ width: '100%', padding: '18px', fontSize: '1.1rem', background: '#12161b', color: '#6b7280', fontWeight: 'bold', border: '1px solid #1a1e23', borderRadius: '8px' }}>
            WAITING FOR NEXT ROUND
          </button>
        )}

        {gameState === 'CRASHED' && isBetPlaced && !isCashedOut && (
          <div style={{ textAlign: 'center', background: 'rgba(255, 0, 85, 0.1)', color: '#ff0055', fontWeight: 'bold', padding: '15px', border: '1px dashed #ff0055', borderRadius: '8px' }}>
            CRASHED
          </div>
        )}
        
        {(gameState === 'CRASHED' || gameState === 'LOADING') && (!isBetPlaced || isCashedOut) && (
          <button disabled style={{ width: '100%', padding: '18px', fontSize: '1.1rem', background: '#12161b', color: '#6b7280', fontWeight: 'bold', border: '1px solid #1a1e23', borderRadius: '8px' }}>
            {isCashedOut ? `WON $${winnings?.toFixed(2)}` : 'WAITING FOR NEXT ROUND'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function CyberCrashGame({ currentUser, onBalanceUpdate }) {
  const [gameState, setGameState] = useState('LOADING'); // LOADING, BETTING, FLIGHT, CRASHED
  const [multiplier, setMultiplier] = useState(1.0);
  const [targetMultiplier, setTargetMultiplier] = useState(1.0);
  const [crashPoint, setCrashPoint] = useState(null);
  
  const [activeBets, setActiveBets] = useState([]);
  const [history, setHistory] = useState([]);
  
  const [panel1, setPanel1] = useState({ betAmount: 10, isBetPlaced: false, isCashedOut: false, winnings: 0, betId: null });

  const [countdown, setCountdown] = useState(0);

  const canvasRef = useRef(null);
  const appRef = useRef(null);
  const curveGraphicsRef = useRef(null);
  const rocketRef = useRef(null);
  const stateRef = useRef(gameState);
  const targetMultRef = useRef(targetMultiplier);
  const crashPointRef = useRef(crashPoint);

  useEffect(() => {
    stateRef.current = gameState;
    targetMultRef.current = targetMultiplier;
    crashPointRef.current = crashPoint;
  }, [gameState, targetMultiplier, crashPoint]);

  useEffect(() => {
    if (gameState === 'BETTING' && countdown > 0) {
      const timer = setInterval(() => {
        setCountdown(prev => Math.max(0, prev - 0.1));
      }, 100);
      return () => clearInterval(timer);
    }
  }, [gameState, countdown]);

  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const [activeRes, histRes] = await Promise.all([
          fetch(`${API_BASE}/api/crash/active-bets`),
          fetch(`${API_BASE}/api/crash/history?email=${encodeURIComponent(currentUser.email)}`)
        ]);
        const activeData = await activeRes.json();
        const histData = await histRes.json();
        
        if (activeData.success) setActiveBets(activeData.bets);
        if (histData.success) setHistory(histData.history);
      } catch (err) {
        console.error('Failed to fetch initial crash data');
      }
    };
    fetchInitialData();
  }, [currentUser.email]);

  useEffect(() => {
    // 1. Initialize Pixi.js WebGL application
    const app = new PIXI.Application({
      width: 800,
      height: 400,
      backgroundColor: 0x020704, // Dark dashboard theme
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true
    });
    
    // Inject Canvas
    if (canvasRef.current) {
      canvasRef.current.appendChild(app.view);
    }
    appRef.current = app;

    // 1.5 Clouds Parallax Background
    const cloudsContainer = new PIXI.Container();
    app.stage.addChild(cloudsContainer);
    const clouds = [];
    for (let i = 0; i < 12; i++) {
      const cloud = new PIXI.Text('☁️', { fontSize: Math.random() * 50 + 30 });
      cloud.x = Math.random() * 800;
      cloud.y = Math.random() * 250; // Keep them in the sky
      cloud.alpha = Math.random() * 0.15 + 0.05; // Faint background clouds
      cloud.speed = Math.random() * 1.5 + 0.5; // Parallax speed
      clouds.push(cloud);
      cloudsContainer.addChild(cloud);
    }

    // 2. Dynamic Trail Curve
    const curve = new PIXI.Graphics();
    app.stage.addChild(curve);
    curveGraphicsRef.current = curve;

    // 3. Airplane
    const rocketContainer = new PIXI.Container();
    const rocketCore = new PIXI.Text('✈️', { fontSize: 48 });
    rocketCore.anchor.set(0.5);
    rocketCore.rotation = Math.PI / 8; // Adjust airplane default angle
    rocketContainer.addChild(rocketCore);
    app.stage.addChild(rocketContainer);
    rocketRef.current = rocketContainer;

    // 4. Interpolation Render Loop (60 FPS)
    let currentVisMultiplier = 1.0;
    let prevX = 0;
    let prevY = 400;
    
    app.ticker.add((delta) => {
      const activeState = stateRef.current;
      const tMult = targetMultRef.current;
      const cPoint = crashPointRef.current;
      
      if (activeState === 'FLIGHT') {
        let visualElapsedMs = Math.log(currentVisMultiplier) / Math.log(1.00006);
        visualElapsedMs += (16.666 * delta); 
        const targetElapsedMs = Math.log(Math.max(1, tMult)) / Math.log(1.00006);
        visualElapsedMs += (targetElapsedMs - visualElapsedMs) * 0.05; 
        currentVisMultiplier = Math.pow(1.00006, visualElapsedMs);
      } else if (activeState === 'CRASHED' || activeState === 'BETTING') {
        currentVisMultiplier = cPoint || tMult;
      }

      setMultiplier(currentVisMultiplier);

      const maxLog = Math.log(20); 
      const curLog = Math.max(0, Math.log(currentVisMultiplier));
      const progress = Math.min(1, curLog / maxLog); 

      // WIDER Flight Path
      const targetX = progress * 800; // Stretch all the way to 800 width
      const targetY = 400 - Math.pow(progress, 1.8) * 350; // Curve up from bottom

      // Parallax Clouds Animation
      const cloudSpeedMultiplier = activeState === 'FLIGHT' ? (1 + progress * 6) : 0.3;
      clouds.forEach(c => {
        c.x -= c.speed * cloudSpeedMultiplier;
        if (activeState === 'FLIGHT') {
          c.y += (progress * c.speed * 0.5); // Push clouds down as we climb
        }
        if (c.x < -100 || c.y > 450) {
          c.x = 850 + Math.random() * 100;
          c.y = Math.random() * 250 - 50;
        }
      });

      const dx = targetX - prevX;
      const dy = targetY - prevY;
      if (dx > 0.1 || Math.abs(dy) > 0.1) {
        const angle = Math.atan2(dy, dx);
        rocketContainer.rotation = angle;
      }

      rocketContainer.x = targetX;
      rocketContainer.y = targetY;
      prevX = targetX;
      prevY = targetY;

      // Draw filled dynamic golden flight path curve
      curve.clear();
      
      // Fill under curve
      curve.beginFill(0xffaa00, 0.15); // Golden fill with opacity
      curve.moveTo(0, 400); // Bottom left
      curve.quadraticCurveTo(targetX * 0.5, 400, targetX, targetY); // Curve with flat start
      curve.lineTo(targetX, 400); // Down to floor
      curve.lineTo(0, 400); // Back to bottom left
      curve.endFill();

      // Draw the bright golden line
      curve.lineStyle(4, 0xffaa00, 1);
      curve.moveTo(0, 400);
      curve.quadraticCurveTo(targetX * 0.5, 400, targetX, targetY);

      if (activeState === 'CRASHED') {
        curve.tint = 0xff0055;
        rocketCore.alpha = 0.5;
      } else {
        curve.tint = 0xffffff;
        rocketCore.alpha = 1.0;
      }
    });

    return () => {
      app.destroy(true, { children: true });
    };
  }, []);

  useEffect(() => {
    const socket = io(API_BASE);

    const handleState = (data) => {
      setGameState(data.status);
      if (data.status === 'BETTING') {
        setTargetMultiplier(1.0);
        setCrashPoint(1.0);
        setActiveBets([]);
        setPanel1(p => ({ ...p, isBetPlaced: false, isCashedOut: false, winnings: 0, betId: null }));
        if (data.timeRemaining) setCountdown(data.timeRemaining / 1000);
      } else if (data.status === 'CRASHED') {
        setCrashPoint(data.multiplier);
        setTargetMultiplier(data.multiplier);
        
        // Mark remaining locked bets as lost locally for UI update
        setActiveBets(prev => prev.map(b => b.status === 'LOCKED' ? { ...b, status: 'LOST' } : b));
        
        // Refresh history to catch the crash points accurately
        fetch(`${API_BASE}/api/crash/history?email=${encodeURIComponent(currentUser.email)}`)
          .then(res => res.json())
          .then(data => { if (data.success) setHistory(data.history); });
      }
    };

    const handleTick = (data) => {
      if (stateRef.current !== 'CRASHED') {
        setTargetMultiplier(data.multiplier);
      }
    };

    const handleBetPlaced = (betData) => {
      setActiveBets(prev => [betData, ...prev]);
    };

    const handleCashedOut = (betData) => {
      setActiveBets(prev => prev.map(b => b.id === betData.id ? betData : b));
    };

    socket.on('crash_state', handleState);
    socket.on('crash_tick', handleTick);
    socket.on('crash_bet_placed', handleBetPlaced);
    socket.on('crash_cashed_out', handleCashedOut);

    return () => {
      socket.disconnect();
    };
  }, [currentUser.email]);

  const handleBet = async (panelId) => {
    const panel = panel1;
    try {
      const res = await fetch(`${API_BASE}/api/crash/bet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: currentUser.email, bet: panel.betAmount })
      });
      const data = await res.json();
      if (data.success) {
        setPanel1({ ...panel, isBetPlaced: true, betId: data.betId });
        onBalanceUpdate(data.newBalance);
      } else {
        alert(data.error);
      }
    } catch (err) {
      alert('Error placing bet');
    }
  };

  const handleCashOut = async (panelId) => {
    const panel = panel1;
    if (!panel.betId) return;

    try {
      const res = await fetch(`${API_BASE}/api/crash/cashout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: currentUser.email, betId: panel.betId })
      });
      const data = await res.json();
      if (data.success) {
        setPanel1({ ...panel, isCashedOut: true, winnings: data.payout });
        onBalanceUpdate(data.newBalance);
      } else {
        alert(data.error);
      }
    } catch (err) {
      alert('Error cashing out');
    }
  };

  return (
    <div style={{ 
      display: 'grid', 
      gridTemplateColumns: '320px 1fr', 
      gap: '20px', 
      background: '#020704', 
      padding: '20px', 
      minHeight: 'calc(100vh - 80px)',
      fontFamily: 'Outfit, sans-serif' 
    }}>
      {/* Left Sidebar - Active Bets */}
      <div style={{ gridColumn: '1 / 2', height: '100%', maxHeight: 'calc(100vh - 120px)' }}>
        <CrashPlayersTable activeBets={activeBets} />
      </div>

      {/* Main Center Area - Canvas & Bottom Area */}
      <div style={{ gridColumn: '2 / 3', display: 'flex', flexDirection: 'column', gap: '20px', overflow: 'hidden' }}>
        
        {/* Top: Canvas Area */}
        <div style={{ position: 'relative', height: '400px', flex: 'none', border: '1px solid #1a1e23', borderRadius: '16px', overflow: 'hidden', background: '#0a0d10' }}>
          
          <div style={{ 
            position: 'absolute', top: '15px', right: '20px', 
            fontSize: '14px', color: '#ffaa00', fontFamily: 'Orbitron', fontWeight: 'bold', zIndex: 10,
            display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,170,0,0.1)', padding: '5px 12px', borderRadius: '20px'
          }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: gameState === 'CRASHED' ? '#ff0055' : '#ffaa00', boxShadow: '0 0 10px #ffaa00' }}></div>
            {gameState}
          </div>

          {gameState === 'BETTING' ? (
            <div style={{ 
              position: 'absolute', top: '40%', left: '50%', transform: 'translate(-50%, -50%)', 
              display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 10 
            }}>
              <div style={{ fontSize: '1.5rem', color: '#ffaa00', fontFamily: 'Orbitron', marginBottom: '10px' }}>
                STARTING IN
              </div>
              <div style={{ fontSize: '5rem', fontFamily: 'Orbitron', fontWeight: 900, color: '#fff', textShadow: '0 0 30px rgba(0,0,0,0.8)' }}>
                {countdown.toFixed(1)}s
              </div>
            </div>
          ) : (
            <div style={{ 
              position: 'absolute', top: '40%', left: '50%', transform: 'translate(-50%, -50%)', 
              fontSize: '5rem', fontFamily: 'Orbitron', fontWeight: 900, 
              color: gameState === 'CRASHED' ? '#ff0055' : '#fff', 
              textShadow: '0 0 30px rgba(0,0,0,0.8)', zIndex: 10 
            }}>
              {multiplier.toFixed(2)}x
            </div>
          )}

          {gameState === 'CRASHED' && (
            <div style={{ 
              position: 'absolute', top: '65%', left: '50%', transform: 'translate(-50%, -50%)', 
              fontSize: '1.2rem', fontFamily: 'Orbitron', fontWeight: 900, color: '#ff0055', zIndex: 10 
            }}>
              CRASHED AT {crashPoint?.toFixed(2)}x
            </div>
          )}

          <div ref={canvasRef} style={{ width: '100%', height: '100%' }} />
        </div>

        {/* Bottom: My Bets + Wager Amount */}
        <div style={{ display: 'flex', gap: '20px', flex: 1, overflow: 'hidden' }}>
          
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <CrashHistoryTable history={history} />
          </div>

          <div style={{ width: '300px', display: 'flex', flexDirection: 'column' }}>
            <BettingPanel id={1} state={panel1} setState={setPanel1} onBet={handleBet} onCashOut={handleCashOut} gameState={gameState} currentUser={currentUser} />
          </div>
          
        </div>
      </div>
    </div>
  );
}
