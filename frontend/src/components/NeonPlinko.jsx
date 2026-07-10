import React, { useState, useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';

const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:5000' : '';

const PLINKO_MULTIPLIERS = {
  8: {
    Low: [5.6, 1.6, 1.1, 1.0, 0.5, 1.0, 1.1, 1.6, 5.6],
    Medium: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
    High: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29]
  },
  9: {
    Low: [5.6, 2.0, 1.6, 1.0, 0.7, 0.7, 1.0, 1.6, 2.0, 5.6],
    Medium: [18, 4, 1.7, 0.9, 0.5, 0.5, 0.9, 1.7, 4, 18],
    High: [43, 7, 2.0, 0.6, 0.2, 0.2, 0.6, 2.0, 7, 43]
  },
  10: {
    Low: [8.9, 3.0, 1.4, 1.1, 1.0, 0.5, 1.0, 1.1, 1.4, 3.0, 8.9],
    Medium: [22, 5, 2.0, 1.4, 0.6, 0.4, 0.6, 1.4, 2.0, 5, 22],
    High: [76, 10, 3.0, 0.9, 0.3, 0.2, 0.3, 0.9, 3.0, 10, 76]
  },
  11: {
    Low: [8.9, 3.0, 1.7, 1.1, 1.0, 0.7, 0.7, 1.0, 1.1, 1.7, 3.0, 8.9],
    Medium: [24, 6, 3.0, 1.8, 0.7, 0.5, 0.5, 0.7, 1.8, 3.0, 6, 24],
    High: [120, 14, 4.3, 1.4, 0.4, 0.2, 0.2, 0.4, 1.4, 4.3, 14, 120]
  },
  12: {
    Low: [10, 4.0, 2.0, 1.6, 1.1, 1.0, 0.5, 1.0, 1.1, 1.6, 2.0, 4.0, 10],
    Medium: [33, 11, 4.0, 2.0, 1.1, 0.6, 0.3, 0.6, 1.1, 2.0, 4.0, 11, 33],
    High: [170, 24, 8.1, 2.0, 0.7, 0.2, 0.2, 0.2, 0.7, 2.0, 8.1, 24, 170]
  },
  13: {
    Low: [10, 4.0, 2.0, 1.6, 1.2, 1.0, 0.7, 0.7, 1.0, 1.2, 1.6, 2.0, 4.0, 10],
    Medium: [43, 13, 6.0, 3.0, 1.3, 0.7, 0.4, 0.4, 0.7, 1.3, 3.0, 6.0, 13, 43],
    High: [260, 37, 11, 4.0, 1.0, 0.2, 0.2, 0.2, 0.2, 1.0, 4.0, 11, 37, 260]
  },
  14: {
    Low: [16, 7.0, 4.0, 1.9, 1.4, 1.0, 0.5, 0.5, 0.5, 1.0, 1.4, 1.9, 4.0, 7.0, 16],
    Medium: [58, 15, 7.0, 4.0, 1.9, 1.0, 0.5, 0.2, 0.5, 1.0, 1.9, 4.0, 7.0, 15, 58],
    High: [420, 56, 18, 5.0, 1.9, 0.3, 0.2, 0.2, 0.2, 0.3, 1.9, 5.0, 18, 56, 420]
  },
  15: {
    Low: [16, 7.0, 4.0, 1.9, 1.4, 1.1, 1.0, 0.7, 0.7, 1.0, 1.1, 1.4, 1.9, 4.0, 7.0, 16],
    Medium: [88, 18, 9.0, 5.0, 2.5, 1.3, 0.5, 0.3, 0.3, 0.5, 1.3, 2.5, 5.0, 9.0, 18, 88],
    High: [620, 83, 27, 8.0, 3.0, 0.5, 0.2, 0.2, 0.2, 0.2, 0.5, 3.0, 8.0, 27, 83, 620]
  },
  16: {
    Low: [16, 9.0, 2.0, 1.4, 1.3, 1.1, 1.0, 0.5, 0.5, 0.5, 1.0, 1.1, 1.3, 1.4, 2.0, 9.0, 16],
    Medium: [110, 41, 10, 5.0, 3.0, 1.5, 1.0, 0.5, 0.3, 0.5, 1.0, 1.5, 3.0, 5.0, 10, 41, 110],
    High: [1000, 130, 26, 9.0, 4.0, 2.0, 0.2, 0.2, 0.2, 0.2, 0.2, 2.0, 4.0, 9.0, 26, 130, 1000]
  }
};

function NeonPlinko({ currentUser, onBalanceUpdate }) {
  const [wagerAmount, setWagerAmount] = useState(10);
  const [rows, setRows] = useState(12);
  const [risk, setRisk] = useState('Medium');
  const [history, setHistory] = useState([]);
  const [isDropping, setIsDropping] = useState(false);

  const canvasRef = useRef(null);
  const pixiAppRef = useRef(null);
  const activeBallsRef = useRef([]);
  const pegboardContainerRef = useRef(null);
  const binsContainerRef = useRef(null);
  const particlesRef = useRef([]);

  // Load history on mount or user change
  const fetchHistory = async () => {
    if (!currentUser) return;
    try {
      const res = await fetch(`${API_BASE}/api/plinko/history?email=${encodeURIComponent(currentUser.email)}`);
      const data = await res.json();
      if (data.success) {
        setHistory(data.history);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [currentUser]);

  // Setup PixiJS Application
  useEffect(() => {
    if (!canvasRef.current) return;

    // Create App
    const app = new PIXI.Application({
      width: 800,
      height: 600,
      backgroundAlpha: 0,
      antialias: true,
    });

    app.stage.eventMode = 'none';
    pixiAppRef.current = app;

    // Inject canvas into container div
    app.view.style.width = '100%';
    app.view.style.height = '100%';
    app.view.style.display = 'block';
    canvasRef.current.appendChild(app.view);

    // Create Containers
    const pegboard = new PIXI.Container();
    app.stage.addChild(pegboard);
    pegboardContainerRef.current = pegboard;

    const bins = new PIXI.Container();
    app.stage.addChild(bins);
    binsContainerRef.current = bins;

    // Drawing the pegboard & bins based on row selection
    drawBoard(app, rows, risk);

    // Pixi Animation Loop
    app.ticker.add((delta) => {
      const balls = activeBallsRef.current;
      const particles = particlesRef.current;

      // 1. Update Balls
      for (let i = balls.length - 1; i >= 0; i--) {
        const ball = balls[i];
        ball.stepProgress += 0.08 * delta; // Animation speed

        if (ball.stepProgress >= 1.0) {
          ball.stepProgress = 0;
          ball.currentRow++;

          // Update start position to current position
          ball.startX = ball.targetX;
          ball.startY = ball.targetY;

          if (ball.currentRow < ball.path.length) {
            // Next bounce position calculation
            const direction = ball.path[ball.currentRow]; // 0 = Left, 1 = Right
            const spacingX = 34;
            const spacingY = 28;
            ball.targetX = ball.startX + (direction === 1 ? spacingX / 2 : -spacingX / 2);
            ball.targetY = ball.startY + spacingY;
          } else {
            // Ball has landed!
            handleBallLanding(ball);
            ball.graphic.destroy();
            balls.splice(i, 1);
            continue;
          }
        }

        // Interpolate position with organic bounce height curve
        const progress = ball.stepProgress;
        const bounceHeight = 10;
        const currentX = ball.startX + progress * (ball.targetX - ball.startX);
        const currentY = ball.startY + progress * (ball.targetY - ball.startY) - Math.sin(progress * Math.PI) * bounceHeight;

        ball.graphic.x = currentX;
        ball.graphic.y = currentY;
      }

      // 2. Update Particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * delta;
        p.y += p.vy * delta;
        p.alpha -= 0.03 * delta;
        p.graphic.x = p.x;
        p.graphic.y = p.y;
        p.graphic.alpha = p.alpha;

        if (p.alpha <= 0) {
          p.graphic.destroy();
          particles.splice(i, 1);
        }
      }
    });

    return () => {
      if (canvasRef.current && app.view) {
        try {
          canvasRef.current.removeChild(app.view);
        } catch (e) {
          // ignore if already removed
        }
      }
      app.destroy(true, { children: true, texture: true, baseTexture: true });
      pixiAppRef.current = null;
    };
  }, [rows, risk]);

  // Redraw pegboard and bins on config change
  const drawBoard = (app, totalRows, currentRisk) => {
    const pegboard = pegboardContainerRef.current;
    const bins = binsContainerRef.current;

    pegboard.removeChildren();
    bins.removeChildren();

    const spacingX = 34;
    const spacingY = 28;
    const centerX = 400;
    const startY = 40;

    // Draw pegs (triangular pegboard)
    for (let r = 0; r < totalRows; r++) {
      const pegsCount = r + 3;
      const rowY = startY + r * spacingY;

      for (let i = 0; i < pegsCount; i++) {
        const pegX = centerX + (i - (pegsCount - 1) / 2) * spacingX;

        // Draw peg graphic
        const peg = new PIXI.Graphics();
        peg.beginFill(0x00ffcc, 0.4); // Semi-transparent neon cyan
        peg.drawCircle(0, 0, 4);
        peg.endFill();
        peg.x = pegX;
        peg.y = rowY;
        pegboard.addChild(peg);
      }
    }

    // Draw Bins at the bottom
    const multipliers = PLINKO_MULTIPLIERS[totalRows][currentRisk];
    const binY = startY + totalRows * spacingY + 15;
    const binWidth = 30;
    const binHeight = 35;

    for (let b = 0; b <= totalRows; b++) {
      const binX = centerX + (b - totalRows / 2) * spacingX - binWidth / 2;

      // Color scheme based on multiplier value
      const mult = multipliers[b];
      let color = 0x1a1d24; // Default low value gray
      if (mult > 5.0) color = 0xffa500; // Orange medium wins
      if (mult > 20.0) color = 0xff0055; // Magenta high wins
      if (mult < 1.0) color = 0x2d323f; // Less than 1x loss range

      const binBox = new PIXI.Graphics();
      binBox.beginFill(color, 0.85);
      binBox.lineStyle(1.5, color, 1);
      binBox.drawRoundedRect(0, 0, binWidth, binHeight, 4);
      binBox.endFill();
      binBox.x = binX;
      binBox.y = binY;
      bins.addChild(binBox);

      // Add Text Label inside the box
      const textStyle = new PIXI.TextStyle({
        fontFamily: 'Orbitron',
        fontSize: totalRows > 13 ? 8 : 10,
        fontWeight: 'bold',
        fill: '#ffffff',
        align: 'center',
      });
      const label = new PIXI.Text(`${mult}x`, textStyle);
      label.anchor.set(0.5);
      label.x = binWidth / 2;
      label.y = binHeight / 2;
      binBox.addChild(label);
    }
  };

  const handleBallLanding = (ball) => {
    // 1. Spawning Spark particles on landing
    const app = pixiAppRef.current;
    if (!app) return;

    for (let i = 0; i < 15; i++) {
      const pG = new PIXI.Graphics();
      pG.beginFill(0xff0055);
      pG.drawCircle(0, 0, Math.random() * 3 + 1);
      pG.endFill();
      pG.x = ball.targetX;
      pG.y = ball.targetY;
      app.stage.addChild(pG);

      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 4 + 2;

      particlesRef.current.push({
        graphic: pG,
        x: ball.targetX,
        y: ball.targetY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2, // Upward force
        alpha: 1,
      });
    }

    // 2. Add history record locally
    const newRecord = {
      id: Math.random(),
      wager_amount: wagerAmount,
      rows: rows,
      risk: risk,
      multiplier: ball.multiplier,
      payout: ball.payout,
      timestamp: new Date().toISOString(),
    };
    setHistory((prev) => [newRecord, ...prev.slice(0, 19)]);
    onBalanceUpdate(ball.newBalance);
  };

  // Drop triggering endpoint request
  const handleDrop = async () => {
    if (!currentUser) return;
    setIsDropping(true);

    try {
      const res = await fetch(`${API_BASE}/api/plinko/drop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: currentUser.email,
          wagerAmount: wagerAmount,
          rows: rows,
          risk: risk,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        alert(data.error || 'Wager failed');
        setIsDropping(false);
        return;
      }

      // Deduct balance locally immediately for responsiveness
      onBalanceUpdate(currentUser.balance - wagerAmount);

      // Create falling ball inside Pixi
      const app = pixiAppRef.current;
      if (app) {
        const ballGraphic = new PIXI.Graphics();
        ballGraphic.beginFill(0xff0055); // Neon magenta orb
        ballGraphic.drawCircle(0, 0, 6.5);
        ballGraphic.endFill();

        // Position at top center
        const startX = 400;
        const startY = 15;
        ballGraphic.x = startX;
        ballGraphic.y = startY;
        app.stage.addChild(ballGraphic);

        const spacingX = 34;
        const spacingY = 28;
        const direction = data.path[0];
        const targetX = startX + (direction === 1 ? spacingX / 2 : -spacingX / 2);
        const targetY = startY + spacingY + 25; // Adjusted start row drop offset

        activeBallsRef.current.push({
          graphic: ballGraphic,
          startX: startX,
          startY: startY + 20,
          targetX: targetX,
          targetY: targetY,
          stepProgress: 0,
          currentRow: 0,
          path: data.path,
          multiplier: data.multiplier,
          payout: data.payout,
          newBalance: data.newBalance,
        });
      }

    } catch (err) {
      console.error(err);
      alert('Network error connecting to Plinko server.');
    } finally {
      setIsDropping(false);
    }
  };

  return (
    <div className="plinko-main-container" style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '25px', padding: '20px' }}>
      
      {/* 1. Left Control Panel */}
      <div className="plinko-controls-panel" style={{
        background: 'rgba(10, 14, 18, 0.7)',
        border: '1px solid var(--glass-border)',
        borderRadius: '16px',
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        backdropFilter: 'blur(15px)'
      }}>
        <h2 style={{ fontFamily: 'Orbitron', color: '#fff', fontSize: '1.4rem', letterSpacing: '1px', textShadow: '0 0 10px rgba(255,255,255,0.1)', margin: 0 }}>
          NEON CASCADE
        </h2>
        <div style={{ fontSize: '11px', color: 'var(--text-gray)', fontFamily: 'Outfit', textTransform: 'uppercase', letterSpacing: '1.5px', marginTop: '-15px' }}>
          Provably Fair Pegboard
        </div>

        {/* Wager Input */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label style={{ fontSize: '11px', fontFamily: 'Orbitron', fontWeight: 'bold', color: 'var(--text-gray)' }}>WAGER AMOUNT</label>
          <div style={{ display: 'flex', position: 'relative' }}>
            <span style={{ position: 'absolute', left: '15px', top: '50%', transform: 'translateY(-50%)', color: 'var(--neon-green)', fontWeight: 'bold', fontFamily: 'Orbitron' }}>$</span>
            <input 
              type="number"
              value={wagerAmount}
              onChange={(e) => setWagerAmount(Math.max(1, parseFloat(e.target.value) || 0))}
              style={{
                width: '100%',
                background: 'rgba(0,0,0,0.5)',
                border: '1px solid var(--glass-border)',
                borderRadius: '8px',
                padding: '12px 12px 12px 30px',
                color: '#fff',
                fontSize: '1rem',
                fontFamily: 'Orbitron',
                fontWeight: 'bold',
                outline: 'none'
              }}
            />
          </div>
          {/* Quick wagers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
            {[10, 50, 100, 500].map(val => (
              <button 
                key={val} 
                onClick={() => setWagerAmount(val)}
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: '6px',
                  color: 'var(--text-gray)',
                  padding: '6px 0',
                  fontSize: '11px',
                  fontFamily: 'Orbitron',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-gray)'; e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
              >
                +{val}
              </button>
            ))}
          </div>
        </div>

        {/* Rows Selection */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label style={{ fontSize: '11px', fontFamily: 'Orbitron', fontWeight: 'bold', color: 'var(--text-gray)' }}>ROWS ({rows})</label>
          <input 
            type="range"
            min="8"
            max="16"
            step="1"
            value={rows}
            onChange={(e) => setRows(parseInt(e.target.value, 10))}
            style={{
              width: '100%',
              accentColor: 'var(--neon-green)',
              cursor: 'pointer'
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'between', fontSize: '9px', color: 'rgba(255,255,255,0.4)', fontFamily: 'Orbitron' }}>
            <span>8 ROWS</span>
            <span style={{ marginLeft: 'auto' }}>16 ROWS</span>
          </div>
        </div>

        {/* Risk Level */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label style={{ fontSize: '11px', fontFamily: 'Orbitron', fontWeight: 'bold', color: 'var(--text-gray)' }}>RISK LEVEL</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
            {['Low', 'Medium', 'High'].map(tier => (
              <button
                key={tier}
                onClick={() => setRisk(tier)}
                style={{
                  background: risk === tier ? 'rgba(0,255,102,0.1)' : 'rgba(255,255,255,0.03)',
                  border: risk === tier ? '1px solid var(--neon-green)' : '1px solid rgba(255,255,255,0.06)',
                  borderRadius: '8px',
                  color: risk === tier ? 'var(--neon-green)' : 'var(--text-gray)',
                  padding: '10px 0',
                  fontSize: '11px',
                  fontFamily: 'Orbitron',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                {tier.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Drop Trigger Button */}
        <button
          onClick={handleDrop}
          style={{
            background: 'var(--neon-green)',
            border: 'none',
            borderRadius: '12px',
            color: '#000',
            fontFamily: 'Orbitron',
            fontWeight: '900',
            fontSize: '1.1rem',
            padding: '16px 0',
            cursor: 'pointer',
            marginTop: '10px',
            boxShadow: '0 0 20px rgba(0,255,102,0.4)',
            transition: 'all 0.2s',
            letterSpacing: '1px'
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 0 25px var(--neon-green)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 0 20px rgba(0,255,102,0.4)'; }}
        >
          RELEASE ORB
        </button>
      </div>

      {/* 2. Right Canvas Area & history */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        
        {/* Canvas container */}
        <div style={{
          background: 'rgba(7, 10, 14, 0.8)',
          border: '1px solid var(--glass-border)',
          borderRadius: '16px',
          overflow: 'hidden',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '600px',
          position: 'relative',
          boxShadow: '0 4px 30px rgba(0,0,0,0.5)',
          backdropFilter: 'blur(10px)'
        }}>
          {/* Subtle starry tech grid background */}
          <div style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            backgroundImage: 'radial-gradient(rgba(0, 255, 204, 0.03) 1px, transparent 0)',
            backgroundSize: '24px 24px',
            pointerEvents: 'none',
            zIndex: 0
          }} />
          
          <div ref={canvasRef} style={{ width: '800px', height: '600px', zIndex: 1, maxWidth: '100%', maxHeight: '100%' }} />
        </div>

        {/* 3. History Feed */}
        <div style={{
          background: 'rgba(10, 14, 18, 0.7)',
          border: '1px solid var(--glass-border)',
          borderRadius: '16px',
          padding: '20px',
          backdropFilter: 'blur(15px)'
        }}>
          <h3 style={{ fontFamily: 'Orbitron', fontSize: '11px', color: 'var(--text-gray)', letterSpacing: '1.5px', margin: '0 0 15px 0', textTransform: 'uppercase' }}>
            MY RECENT DROPS
          </h3>
          <div style={{ maxHeight: '150px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {history.length === 0 ? (
              <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.3)', fontFamily: 'Outfit', textAlign: 'center', padding: '15px 0' }}>
                No drops logged in this session yet. Release an orb to see wagers!
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '8px' }}>
                {history.map((h) => (
                  <div key={h.id} style={{
                    background: 'rgba(0,0,0,0.3)',
                    border: '1px solid rgba(255,255,255,0.05)',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    fontFamily: 'Orbitron',
                    fontSize: '11px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'rgba(255,255,255,0.4)' }}>
                      <span>{h.rows}R - {h.risk}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2px' }}>
                      <span style={{ color: '#fff' }}>${h.wager_amount}</span>
                      <span style={{ 
                        color: h.multiplier >= 1.0 ? 'var(--neon-green)' : 'rgba(255,255,255,0.4)', 
                        textShadow: h.multiplier >= 1.0 ? '0 0 5px var(--neon-green)' : 'none',
                        fontWeight: 'bold' 
                      }}>
                        {h.multiplier}x
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>

    </div>
  );
}

export default NeonPlinko;
