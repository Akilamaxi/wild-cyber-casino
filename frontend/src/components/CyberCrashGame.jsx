import React, { useState, useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';
import { io } from 'socket.io-client';
import CrashPlayersTable from './CrashPlayersTable';
import CrashHistoryTable from './CrashHistoryTable';

const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:3000' : '';

function BettingPanel({ id, state, setState, onBet, onCashOut, gameState, currentUser }) {
  const { betAmount, isBetPlaced, isCashedOut, winnings } = state;

  return (
    <div style={{ background: '#0a0d10', padding: '15px', borderRadius: '16px', border: '1px solid #1a1e23', flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', color: '#6b7280', fontSize: '14px' }}>
        <span>Wager Amount</span>
        <span>${currentUser.balance.toFixed(2)}</span>
      </div>
      
      <div style={{ display: 'flex', background: '#12161b', borderRadius: '8px', border: '1px solid #1a1e23', padding: '3px' }}>
        <span style={{ padding: '8px', color: '#ffaa00' }}>$</span>
        <input 
          type="number" 
          value={betAmount} 
          onChange={e => setState({ ...state, betAmount: parseFloat(e.target.value) || 0 })}
          disabled={gameState !== 'BETTING' || isBetPlaced}
          style={{ width: '100%', background: 'transparent', color: '#fff', border: 'none', fontSize: '1.2rem', outline: 'none', textAlign: 'right', paddingRight: '10px' }}
        />
      </div>

      <div style={{ display: 'flex', gap: '4px', marginTop: '8px' }}>
        {[10, 50, 100, 500].map(amt => (
          <button 
            key={amt} 
            onClick={() => setState({ ...state, betAmount: amt })}
            disabled={gameState !== 'BETTING' || isBetPlaced}
            style={{ flex: 1, background: '#12161b', color: '#6b7280', border: '1px solid #1a1e23', borderRadius: '4px', padding: '6px 0', cursor: 'pointer', transition: 'all 0.2s' }}
          >
            +{amt}
          </button>
        ))}
      </div>

      <div style={{ marginTop: '12px' }}>
        {gameState === 'BETTING' && !isBetPlaced && (
          <button onClick={() => onBet(id)} style={{ width: '100%', padding: '12px', fontSize: '0.95rem', background: '#ffaa00', color: '#000', fontWeight: 'bold', border: 'none', borderRadius: '8px', cursor: 'pointer', boxShadow: '0 4px 15px rgba(255, 170, 0, 0.2)' }}>
            BET
          </button>
        )}

        {gameState === 'BETTING' && isBetPlaced && (
          <button disabled style={{ width: '100%', padding: '12px', fontSize: '0.95rem', background: 'rgba(255, 170, 0, 0.2)', color: '#ffaa00', fontWeight: 'bold', border: '1px solid #ffaa00', borderRadius: '8px' }}>
            WAITING FOR FLIGHT...
          </button>
        )}

        {gameState === 'FLIGHT' && isBetPlaced && !isCashedOut && (
          <button onClick={() => onCashOut(id)} style={{ width: '100%', padding: '12px', fontSize: '0.95rem', background: '#00ff66', color: '#000', fontWeight: '900', border: 'none', borderRadius: '8px', cursor: 'pointer', boxShadow: '0 0 20px rgba(0,255,102,0.4)' }}>
            CASH OUT
          </button>
        )}

        {gameState === 'FLIGHT' && isCashedOut && (
          <div style={{ textAlign: 'center', background: 'rgba(0, 255, 102, 0.1)', color: '#00ff66', fontWeight: 'bold', padding: '10px', border: '1px solid #00ff66', borderRadius: '8px' }}>
            CASHED OUT<br/>
            <span style={{ fontSize: '1.2rem' }}>+${winnings?.toFixed(2)}</span>
          </div>
        )}

        {gameState === 'FLIGHT' && !isBetPlaced && (
          <button disabled style={{ width: '100%', padding: '12px', fontSize: '0.95rem', background: '#12161b', color: '#6b7280', fontWeight: 'bold', border: '1px solid #1a1e23', borderRadius: '8px' }}>
            WAITING FOR NEXT ROUND
          </button>
        )}

        {gameState === 'CRASHED' && isBetPlaced && !isCashedOut && (
          <div style={{ textAlign: 'center', background: 'rgba(255, 0, 85, 0.1)', color: '#ff0055', fontWeight: 'bold', padding: '10px', border: '1px dashed #ff0055', borderRadius: '8px' }}>
            CRASHED
          </div>
        )}
        
        {(gameState === 'CRASHED' || gameState === 'LOADING') && (!isBetPlaced || isCashedOut) && (
          <button disabled style={{ width: '100%', padding: '12px', fontSize: '0.95rem', background: '#12161b', color: '#6b7280', fontWeight: 'bold', border: '1px solid #1a1e23', borderRadius: '8px' }}>
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
      app.view.style.width = '100%';
      app.view.style.height = '100%';
      app.view.style.display = 'block';
      canvasRef.current.appendChild(app.view);
    }
    appRef.current = app;

    // 1.5 Deep Space Parallax (High-tension Cyberpunk)
    const bgContainer = new PIXI.Container();
    app.stage.addChild(bgContainer);
    
    // Deep purple/blue nebula gradient
    const bgGradient = new PIXI.Graphics();
    bgGradient.beginFill(0x0a001a); // Very deep purple
    bgGradient.drawRect(0, 0, 800, 400);
    bgGradient.endFill();
    bgContainer.addChild(bgGradient);
    
    // Midground Glowing Stars
    const stars = [];
    for(let i=0; i<50; i++) {
        const star = new PIXI.Graphics();
        star.beginFill(Math.random() > 0.5 ? 0x00ffff : 0xff00ff, Math.random() * 0.5 + 0.3);
        star.drawCircle(0, 0, Math.random() * 1.5 + 0.5);
        star.endFill();
        star.x = Math.random() * 800;
        star.y = Math.random() * 400;
        star.speed = Math.random() * 2 + 0.5;
        stars.push(star);
        bgContainer.addChild(star);
    }

    // Foreground Warp Streaks
    const streaks = [];
    for(let i=0; i<15; i++) {
        const streak = new PIXI.Graphics();
        streak.beginFill(0x00ffff, 0.4);
        streak.drawRect(0, 0, Math.random() * 40 + 20, 1);
        streak.endFill();
        streak.x = Math.random() * 800;
        streak.y = Math.random() * 400;
        streak.speed = Math.random() * 15 + 10;
        streaks.push(streak);
        bgContainer.addChild(streak);
    }
    
    // 2. Dynamic Trail Curve
    const curve = new PIXI.Graphics();
    app.stage.addChild(curve);
    curveGraphicsRef.current = curve;
    
    // 2.5 Exhaust Trail Particles (Particle Engine Exhaust)
    const trailParticles = [];
    const trailContainer = new PIXI.Container();
    app.stage.addChild(trailContainer);

    // 3. Cyberpunk Cute Curvy Rocket
    const rocketContainer = new PIXI.Container();
    const rocketCore = new PIXI.Graphics();
    
    // 1. Back booster cup (Hot Magenta)
    rocketCore.beginFill(0x0a001a);
    rocketCore.lineStyle(2, 0xff00ff, 1);
    rocketCore.drawRoundedRect(-32, -6, 8, 12, 3);
    rocketCore.endFill();
    
    // 2. Wings / Fins (Neon Green / Cyan)
    rocketCore.beginFill(0x00ffaa, 0.8);
    rocketCore.lineStyle(2, 0x00ffff, 1);
    // Top wing (curvy swoop)
    rocketCore.moveTo(-15, -10);
    rocketCore.quadraticCurveTo(-35, -28, -22, -6);
    rocketCore.closePath();
    // Bottom wing (curvy swoop)
    rocketCore.moveTo(-15, 10);
    rocketCore.quadraticCurveTo(-35, 28, -22, 6);
    rocketCore.closePath();
    rocketCore.endFill();
    
    // 3. Outer glow layer for main body
    rocketCore.lineStyle(6, 0x00ffff, 0.4);
    rocketCore.drawEllipse(0, 0, 26, 15);
    
    // 4. Main Body Fuselage (Dark body with Neon Cyan border)
    rocketCore.beginFill(0x0a001a);
    rocketCore.lineStyle(2, 0x00ffff, 1);
    rocketCore.drawEllipse(0, 0, 26, 15);
    rocketCore.endFill();
    
    // 5. Curvy Nose Cone (Hot Magenta)
    rocketCore.beginFill(0xff00ff, 0.9);
    rocketCore.lineStyle(2, 0xff00ff, 1);
    rocketCore.moveTo(18, -11);
    rocketCore.quadraticCurveTo(38, 0, 42, 0); // curve to point
    rocketCore.quadraticCurveTo(38, 0, 18, 11); // curve back
    rocketCore.closePath();
    rocketCore.endFill();

    // 6. Round Cabin Window (Neon Cyan glow)
    rocketCore.beginFill(0x0a001a);
    rocketCore.lineStyle(2, 0x00ffff, 1);
    rocketCore.drawCircle(0, 0, 7);
    rocketCore.endFill();
    rocketCore.beginFill(0x00ffff, 0.6);
    rocketCore.lineStyle(0);
    rocketCore.drawCircle(0, 0, 4);
    rocketCore.endFill();
    
    // Add slight upward tilt to chassis and scale down by 25% (zoom out feel)
    rocketCore.rotation = -0.15;
    rocketCore.scale.set(0.75);
    
    rocketContainer.addChild(rocketCore);
    app.stage.addChild(rocketContainer);
    rocketRef.current = rocketContainer;

    // 3.5 Explosion Particles
    const particles = [];
    const explosionContainer = new PIXI.Container();
    app.stage.addChild(explosionContainer);
    for(let i=0; i<60; i++) {
        const p = new PIXI.Graphics();
        p.beginFill(Math.random() > 0.5 ? 0xff0055 : 0xffaa00);
        const radius = Math.random() * 6 + 2;
        if (Math.random() > 0.5) p.drawCircle(0, 0, radius);
        else p.drawRect(-radius, -radius, radius * 2, radius * 2);
        p.endFill();
        p.visible = false;
        particles.push({
            sprite: p,
            vx: (Math.random() - 0.5) * 30,
            vy: (Math.random() - 0.5) * 30,
            life: 1.0
        });
        explosionContainer.addChild(p);
    }
    
    let hasExploded = false;

    // 4. Interpolation Render Loop (60 FPS)
    let currentVisMultiplier = 1.0;
    let prevX = 0;
    let prevY = 350;
    
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

      // WIDER Flight Path (Zoomed out range)
      const targetX = progress * 750; // Keep slightly away from edge
      const targetY = 350 - Math.pow(progress, 1.8) * 270; // Curve up from slightly above bottom

      // High-frequency camera shake at 10x
      let shakeX = 0;
      let shakeY = 0;
      if (currentVisMultiplier >= 10.0 && activeState === 'FLIGHT') {
          shakeX = (Math.random() - 0.5) * 6;
          shakeY = (Math.random() - 0.5) * 6;
      }
      app.stage.x = shakeX;
      app.stage.y = shakeY;

      // Parallax Stars & Streaks
      const speedMulti = activeState === 'FLIGHT' ? (1 + progress * 10) : 1;
      stars.forEach(s => {
          s.x -= s.speed * speedMulti * delta;
          if (s.x < 0) s.x = 800 + Math.random() * 50;
      });
      streaks.forEach(s => {
          s.x -= s.speed * speedMulti * delta * 2;
          if (s.x < 0) s.x = 800 + Math.random() * 100;
      });

      let currentAngle = rocketContainer.rotation;
      const dx = targetX - prevX;
      const dy = targetY - prevY;
      if (dx > 0.1 || Math.abs(dy) > 0.1) {
        let targetAngle = Math.atan2(dy, dx);
        rocketContainer.rotation += (targetAngle - rocketContainer.rotation) * 0.1;
        currentAngle = rocketContainer.rotation;
      }

      rocketContainer.x = targetX;
      rocketContainer.y = targetY;
      prevX = targetX;
      prevY = targetY;

      // Dynamic Particle Engine Exhaust (Pulsating Bloom)
      const bloomIntensity = currentVisMultiplier >= 2.0 ? 1.5 : 1.0;
      if (activeState === 'FLIGHT') {
          for(let k=0; k<2; k++) {
              const p = new PIXI.Graphics();
              p.beginFill(Math.random() > 0.5 ? 0x00ffff : 0x00ffaa); // Cyan or Blue/Green
              p.drawCircle(0, 0, Math.random() * 4 * bloomIntensity + 2);
              p.endFill();
              p.blendMode = PIXI.BLEND_MODES.SCREEN;
              
              // spawn slightly behind the ship
              p.x = targetX - Math.cos(currentAngle) * 15;
              p.y = targetY - Math.sin(currentAngle) * 15;
              p.vx = -Math.cos(currentAngle) * (Math.random() * 6 * bloomIntensity + 2);
              p.vy = -Math.sin(currentAngle) * (Math.random() * 6 * bloomIntensity + 2) + (Math.random() - 0.5);
              p.life = 1.0;
              trailContainer.addChild(p);
              trailParticles.push(p);
          }
      }

      // Update exhaust (Shrink and fade to zero)
      for (let i = trailParticles.length - 1; i >= 0; i--) {
          const p = trailParticles[i];
          p.x += p.vx * delta;
          p.y += p.vy * delta;
          p.life -= 0.05 * delta;
          p.alpha = p.life;
          p.scale.set(p.life); // Shrink dynamically
          if (p.life <= 0) {
              trailContainer.removeChild(p);
              trailParticles.splice(i, 1);
          }
      }

      // Draw Flight Curve Line
      curve.clear();
      curve.lineStyle(8, 0x00ffff, 0.4); // Neon Cyan glow
      curve.moveTo(0, 350);
      curve.quadraticCurveTo(targetX * 0.5, 350, targetX, targetY);
      curve.lineStyle(3, 0xffffff, 1); // Bright core
      curve.moveTo(0, 350);
      curve.quadraticCurveTo(targetX * 0.5, 350, targetX, targetY);

      if (activeState === 'CRASHED') {
        curve.tint = 0xff0055;
        rocketCore.alpha = 0; // hide rocket
        
        if (!hasExploded) {
            hasExploded = true;
            particles.forEach(p => {
                p.sprite.visible = true;
                p.sprite.x = targetX;
                p.sprite.y = targetY;
                p.sprite.alpha = 1.0;
                p.life = 1.0;
                p.sprite.scale.set(1.0);
            });
        } else {
            particles.forEach(p => {
                if (p.life > 0) {
                    p.sprite.x += p.vx * delta;
                    p.sprite.y += p.vy * delta;
                    p.vy += 0.8 * delta; // gravity
                    p.life -= 0.015 * delta;
                    p.sprite.alpha = p.life;
                    p.sprite.rotation += 0.1 * delta;
                } else {
                    p.sprite.visible = false;
                }
            });
        }
      } else {
        hasExploded = false;
        particles.forEach(p => p.sprite.visible = false);
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

  // Dynamic color for multiplier text based on tension
  let multColor = '#00ffff'; // Neon Cyan
  let multShadow = 'rgba(0, 255, 255, 0.8)';
  if (gameState === 'CRASHED') {
    multColor = '#ff0055'; // Danger Red
    multShadow = 'rgba(255, 0, 85, 0.8)';
  } else if (multiplier >= 10) {
    multColor = '#ff0055'; // Danger Red
    multShadow = 'rgba(255, 0, 85, 0.8)';
  } else if (multiplier >= 2) {
    multColor = '#ffaa00'; // Yellow
    multShadow = 'rgba(255, 170, 0, 0.8)';
  }

  return (
    <div className="crash-game-container">
      {/* Left Sidebar - Active Bets */}
      <div className="crash-sidebar-area">
        <CrashPlayersTable activeBets={activeBets} />
      </div>

      {/* Main Center Area - Canvas & Bottom Area */}
      <div className="crash-main-area">
        
        {/* Top: Canvas Area */}
        <div className="crash-canvas-wrapper">
          
          <div style={{ 
            position: 'absolute', top: '15px', right: '20px', 
            fontSize: '14px', color: '#00ffff', fontFamily: 'Orbitron', fontWeight: 'bold', zIndex: 10,
            display: 'flex', alignItems: 'center', gap: '8px', 
            background: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(4px)',
            padding: '5px 12px', borderRadius: '20px', border: '1px solid #00ffff',
            boxShadow: '0 0 10px rgba(0, 255, 255, 0.2)'
          }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: gameState === 'CRASHED' ? '#ff0055' : '#00ffff', boxShadow: `0 0 10px ${gameState === 'CRASHED' ? '#ff0055' : '#00ffff'}` }}></div>
            {gameState}
          </div>

          {gameState === 'BETTING' ? (
            <div style={{ 
              position: 'absolute', top: '40%', left: '50%', transform: 'translate(-50%, -50%)', 
              display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 10,
              background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(12px)', padding: '20px 40px', borderRadius: '24px',
              border: '1px solid rgba(0, 255, 255, 0.5)', boxShadow: 'inset 0 0 10px rgba(0,255,255,0.3)'
            }}>
              <div style={{ fontSize: '1.5rem', color: '#00ffff', fontFamily: 'Orbitron', marginBottom: '10px', textShadow: '0 0 10px #00ffff' }}>
                STARTING IN
              </div>
              <div style={{ fontSize: '5rem', fontFamily: 'Orbitron', fontWeight: 900, color: '#fff', textShadow: '0 0 30px rgba(0,255,255,0.8)' }}>
                {countdown.toFixed(1)}s
              </div>
            </div>
          ) : (
            <div style={{ 
              position: 'absolute', top: '40%', left: '50%', transform: 'translate(-50%, -50%)', 
              display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 10,
              background: 'rgba(0,0,0,0.5)', 
              backdropFilter: 'blur(12px)', padding: '20px 50px', borderRadius: '30px',
              border: `1px solid ${multColor}`,
              boxShadow: `inset 0 0 15px ${multShadow}`
            }}>
              <div style={{
                fontSize: '6rem', fontFamily: 'Orbitron', fontWeight: 900, 
                color: multColor, 
                textShadow: `0 0 30px ${multShadow}`
              }}>
                {multiplier.toFixed(2)}x
              </div>
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
        <div className="crash-game-bottom">
          
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <CrashHistoryTable history={history} />
          </div>

          <div className="crash-bet-panel-col">
            <BettingPanel id={1} state={panel1} setState={setPanel1} onBet={handleBet} onCashOut={handleCashOut} gameState={gameState} currentUser={currentUser} />
          </div>
          
        </div>
      </div>
    </div>
  );
}
