import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import './App.css';

const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:5000' : '';

const SYMBOL_MAP = {
  'BAR': { emoji: '➖', label: 'BAR' },
  'CHERRY': { emoji: '🍒', label: 'CHERRY' },
  'BELL': { emoji: '🔔', label: 'BELL' },
  'DIAMOND': { emoji: '💎', label: 'DIAMOND' },
  'SEVEN': { emoji: '7️⃣', label: 'SEVEN' },
  'WILD': { emoji: '🎰', label: 'WILD' }
};

function App() {
  const [currentUser, setCurrentUser] = useState(() => {
    const saved = localStorage.getItem('cyber_admin_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [activeTab, setActiveTab] = useState('lottery'); // 'lottery' | 'spinwheel' | 'slots'

  // --- Lottery Configurations States ---
  const [games, setGames] = useState([]);
  const [loadingGames, setLoadingGames] = useState(true);
  const [editingGame, setEditingGame] = useState(null);
  const [gameFormData, setGameFormData] = useState({
    id: '', name: '', draw_interval_ms: 60000, ticket_price: 10, max_tickets_per_user: 100, house_edge_percentage: 0.30, status: 'ACTIVE'
  });

  // --- Spin Wheel States ---
  const [prizes, setPrizes] = useState([]);
  const [loadingPrizes, setLoadingPrizes] = useState(true);
  const [editingPrize, setEditingPrize] = useState(null);
  const [prizeFormData, setPrizeFormData] = useState({
    text: '', color: '#ffcc00', textColor: '#000000', mult: 1.0, isBonus: false
  });

  // --- Slots States ---
  const [slotsConfig, setSlotsConfig] = useState({
    payout_strategy: 'FAIR_RNG',
    target_rtp: '0.90',
    symbols_config: '[]'
  });
  const [slotsSymbols, setSlotsSymbols] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(true);

  const canvasRef = useRef(null);
  const socketRef = useRef(null);

  // Load backend configurations
  useEffect(() => {
    if (currentUser && currentUser.role === 'ADMIN') {
      fetchGames();
      fetchPrizes();
      fetchSlotsConfig();

      // Connect WebSockets for real-time config updates
      socketRef.current = io(API_BASE);
      socketRef.current.on('connect', () => {
        console.log('[WS] Admin connected to WebSocket server.');
      });

      socketRef.current.on('lottery_events', (event) => {
        if (event.type === 'GAME_CONFIG_UPDATED') {
          fetchGames();
        }
        if (event.type === 'SPIN_WHEEL_CONFIG_UPDATED') {
          fetchPrizes();
        }
        if (event.type === 'SLOTS_CONFIG_UPDATED') {
          fetchSlotsConfig();
        }
      });

      return () => {
        if (socketRef.current) socketRef.current.disconnect();
      };
    }
  }, [currentUser]);

  // Redraw the canvas wheel whenever prizes change or in editing mode
  useEffect(() => {
    if (activeTab === 'spinwheel' && prizes.length > 0) {
      drawWheel();
    }
  }, [prizes, activeTab]);

  // --- Authentication ---
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (data.user.role === 'ADMIN') {
          setCurrentUser(data.user);
          localStorage.setItem('cyber_admin_user', JSON.stringify(data.user));
        } else {
          setLoginError('Access denied. You do not have administrative privileges.');
        }
      } else {
        setLoginError(data.error || 'Invalid credentials.');
      }
    } catch (err) {
      setLoginError('Failed to connect to backend service.');
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('cyber_admin_user');
  };

  // --- Fetchers ---
  const fetchGames = async () => {
    setLoadingGames(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/games`);
      const data = await res.json();
      if (data.success) {
        setGames(data.games);
      }
    } catch (err) {
      console.error(err);
    }
    setLoadingGames(false);
  };

  const fetchPrizes = async () => {
    setLoadingPrizes(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/spinwheel-prizes`);
      const data = await res.json();
      if (data.success) {
        setPrizes(data.prizes);
      }
    } catch (err) {
      console.error(err);
    }
    setLoadingPrizes(false);
  };

  const fetchSlotsConfig = async () => {
    setLoadingSlots(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/slots/config`);
      const data = await res.json();
      if (data.success && data.config) {
        setSlotsConfig(data.config);
        const parsed = JSON.parse(data.config.symbols_config || '[]');
        setSlotsSymbols(parsed);
      }
    } catch (err) {
      console.error(err);
    }
    setLoadingSlots(false);
  };

  // --- Lottery CRUD Operations ---
  const resetGameForm = () => {
    setEditingGame(null);
    setGameFormData({
      id: '', name: '', draw_interval_ms: 60000, ticket_price: 10, max_tickets_per_user: 100, house_edge_percentage: 0.30, status: 'ACTIVE'
    });
  };

  const handleGameSubmit = async (e) => {
    e.preventDefault();
    try {
      const url = editingGame
        ? `${API_BASE}/api/admin/games/${editingGame.id}`
        : `${API_BASE}/api/admin/games`;
      const method = editingGame ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(gameFormData)
      });
      const data = await res.json();
      if (data.success) {
        alert(editingGame ? 'Lottery config updated!' : 'New lottery game deployed!');
        resetGameForm();
        fetchGames();
      } else {
        alert('Error: ' + data.error);
      }
    } catch (err) {
      alert('Error updating configuration: ' + err.message);
    }
  };

  const startEditGame = (game) => {
    setEditingGame(game);
    setGameFormData({
      id: game.id,
      name: game.name,
      draw_interval_ms: game.draw_interval_ms,
      ticket_price: game.ticket_price,
      max_tickets_per_user: game.max_tickets_per_user,
      house_edge_percentage: game.house_edge_percentage,
      status: game.status
    });
  };

  const toggleGameStatus = async (game) => {
    const newStatus = game.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    try {
      await fetch(`${API_BASE}/api/admin/games/${game.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...game, status: newStatus })
      });
      fetchGames();
    } catch (err) {
      alert('Error toggling status');
    }
  };

  // --- Spin Wheel CRUD Operations ---
  const resetPrizeForm = () => {
    setEditingPrize(null);
    setPrizeFormData({
      text: '', color: '#ffcc00', textColor: '#000000', mult: 1.0, isBonus: false
    });
  };

  const handlePrizeSubmit = async (e) => {
    e.preventDefault();
    try {
      const url = editingPrize
        ? `${API_BASE}/api/admin/spinwheel-prizes/${editingPrize.id}`
        : `${API_BASE}/api/admin/spinwheel-prizes`;
      const method = editingPrize ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...prizeFormData,
          isBonus: prizeFormData.isBonus ? 1 : 0
        })
      });
      const data = await res.json();
      if (data.success) {
        alert(editingPrize ? 'Spin Wheel sector updated!' : 'New Spin Wheel sector added!');
        resetPrizeForm();
        fetchPrizes();
      } else {
        alert('Error: ' + data.error);
      }
    } catch (err) {
      alert('Error updating configuration: ' + err.message);
    }
  };

  const startEditPrize = (prize) => {
    setEditingPrize(prize);
    setPrizeFormData({
      text: prize.text,
      color: prize.color,
      textColor: prize.textColor,
      mult: prize.mult,
      isBonus: prize.isBonus === 1
    });
  };

  const handleDeletePrize = async (id) => {
    if (!window.confirm('Are you sure you want to delete this prize sector?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/admin/spinwheel-prizes/${id}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        fetchPrizes();
      }
    } catch (err) {
      alert('Failed to delete prize sector');
    }
  };

  // --- Slots Submit operations ---
  const handleSlotsSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/api/admin/slots/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payout_strategy: slotsConfig.payout_strategy,
          target_rtp: parseFloat(slotsConfig.target_rtp) || 0.90,
          symbols_config: JSON.stringify(slotsSymbols)
        })
      });
      const data = await res.json();
      if (data.success) {
        alert('🎰 Slots configuration rules deployed successfully!');
        fetchSlotsConfig();
      } else {
        alert('Error saving slots configs: ' + data.error);
      }
    } catch (err) {
      alert('Network failure saving config');
    }
  };

  const handleSymbolChange = (index, field, value) => {
    const updated = [...slotsSymbols];
    if (field === 'multiplier' || field === 'weight') {
      updated[index][field] = parseFloat(value) || 0;
    } else {
      updated[index][field] = value;
    }
    setSlotsSymbols(updated);
  };

  // Draw Interactive Preview Wheel on Admin Dashboard
  const drawWheel = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    const center = size / 2;
    const radius = center - 10;
    const numSectors = prizes.length;
    if (numSectors === 0) return;
    const sectorAngle = (2 * Math.PI) / numSectors;

    ctx.clearRect(0, 0, size, size);

    // Save context and draw sectors
    ctx.save();
    for (let i = 0; i < numSectors; i++) {
      const startAngle = i * sectorAngle;
      const endAngle = startAngle + sectorAngle;

      ctx.beginPath();
      ctx.moveTo(center, center);
      ctx.arc(center, center, radius, startAngle, endAngle);
      ctx.fillStyle = prizes[i].color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.stroke();

      // Draw Sector Text
      ctx.save();
      ctx.translate(center, center);
      ctx.rotate(startAngle + sectorAngle / 2);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = prizes[i].textColor || '#ffffff';
      ctx.font = 'bold 9px Orbitron, sans-serif';
      ctx.fillText(prizes[i].text, radius - 15, 0);
      ctx.restore();
    }

    // Draw central hub
    ctx.beginPath();
    ctx.arc(center, center, 20, 0, 2 * Math.PI);
    ctx.fillStyle = '#050510';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffcc00';
    ctx.stroke();

    ctx.restore();
  };

  // Render Authentication Portal
  if (!currentUser) {
    return (
      <div className="admin-login-wrapper">
        <div className="login-box">
          <div className="login-header">
            <h2>🛡️ CYBER CASINO</h2>
            <h1>BACK-OFFICE PORTAL</h1>
          </div>
          {loginError && <div className="login-error-alert">{loginError}</div>}
          <form onSubmit={handleLogin} className="login-form">
            <div className="form-group">
              <label>Email Address</label>
              <input 
                type="email" 
                placeholder="admin@casino.com" 
                value={loginEmail} 
                onChange={e => setLoginEmail(e.target.value)} 
                required 
              />
            </div>
            <div className="form-group">
              <label>Administrator Password</label>
              <input 
                type="password" 
                placeholder="••••••••" 
                value={loginPassword} 
                onChange={e => setLoginPassword(e.target.value)} 
                required 
              />
            </div>
            <button type="submit" className="admin-submit-btn">AUTHORIZE ACCESS</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-dashboard-container">
      {/* Top Navigation Header */}
      <header className="admin-header">
        <div className="header-branding">
          <span className="branding-icon">🛡️</span>
          <div>
            <h1>CYBER CASINO CONTROL CENTER</h1>
            <p>Admin Session: {currentUser.username}</p>
          </div>
        </div>
        <div className="header-actions">
          <button onClick={handleLogout} className="admin-logout-btn">DISCONNECT</button>
        </div>
      </header>

      {/* Main App Layout */}
      <div className="admin-main-layout">
        
        {/* Navigation Sidebar */}
        <aside className="admin-sidebar">
          <ul className="sidebar-menu">
            <li>
              <button 
                onClick={() => setActiveTab('lottery')} 
                className={`menu-btn ${activeTab === 'lottery' ? 'active' : ''}`}
              >
                🎟️ Lottery Configurations
              </button>
            </li>
            <li>
              <button 
                onClick={() => setActiveTab('spinwheel')} 
                className={`menu-btn ${activeTab === 'spinwheel' ? 'active' : ''}`}
              >
                🎡 Spin Wheel Customizer
              </button>
            </li>
            <li>
              <button 
                onClick={() => setActiveTab('slots')} 
                className={`menu-btn ${activeTab === 'slots' ? 'active' : ''}`}
              >
                🎰 Slots Control Desk
              </button>
            </li>
          </ul>
        </aside>

        {/* Dashboard Work Area */}
        <main className="admin-workspace">
          
          {/* TAB 1: LOTTERY MANAGEMENT */}
          {activeTab === 'lottery' && (
            <div className="workspace-flex">
              {/* Form panel */}
              <div className="editor-card">
                <h2>{editingGame ? `EDIT GAME: ${editingGame.id}` : 'DEPLOY NEW LOTTERY'}</h2>
                <form onSubmit={handleGameSubmit} className="admin-form">
                  <div className="form-group">
                    <label>Unique Game ID</label>
                    <input 
                      type="text" 
                      placeholder="e.g., GAME-10" 
                      value={gameFormData.id} 
                      onChange={e => setGameFormData({ ...gameFormData, id: e.target.value })} 
                      required 
                      disabled={!!editingGame}
                    />
                  </div>
                  <div className="form-group">
                    <label>Display Name</label>
                    <input 
                      type="text" 
                      placeholder="e.g., Neon Rollers" 
                      value={gameFormData.name} 
                      onChange={e => setGameFormData({ ...gameFormData, name: e.target.value })} 
                      required 
                    />
                  </div>
                  <div className="form-group">
                    <label>Draw Interval (ms)</label>
                    <input 
                      type="number" 
                      value={gameFormData.draw_interval_ms} 
                      onChange={e => setGameFormData({ ...gameFormData, draw_interval_ms: parseInt(e.target.value) })} 
                      required 
                    />
                  </div>
                  <div className="form-group">
                    <label>Ticket Price ($)</label>
                    <input 
                      type="number" 
                      step="0.1" 
                      value={gameFormData.ticket_price} 
                      onChange={e => setGameFormData({ ...gameFormData, ticket_price: parseFloat(e.target.value) })} 
                      required 
                    />
                  </div>
                  <div className="form-group">
                    <label>House Edge (0.0 to 1.0)</label>
                    <input 
                      type="number" 
                      step="0.01" 
                      value={gameFormData.house_edge_percentage} 
                      onChange={e => setGameFormData({ ...gameFormData, house_edge_percentage: parseFloat(e.target.value) })} 
                      required 
                    />
                  </div>
                  <div className="form-group">
                    <label>Game Status</label>
                    <select 
                      value={gameFormData.status} 
                      onChange={e => setGameFormData({ ...gameFormData, status: e.target.value })}
                    >
                      <option value="ACTIVE">ACTIVE</option>
                      <option value="PAUSED">PAUSED</option>
                    </select>
                  </div>
                  <div className="button-group">
                    <button type="submit" className="primary-btn">{editingGame ? 'SAVE CHANGES' : 'DEPLOY LOTTO'}</button>
                    {editingGame && <button type="button" onClick={resetGameForm} className="secondary-btn">CANCEL</button>}
                  </div>
                </form>
              </div>

              {/* Data list panel */}
              <div className="data-table-card">
                <h2>ACTIVE GAME CONFIGURATIONS</h2>
                {loadingGames ? <div className="loader">Loading configurations...</div> : (
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Name</th>
                        <th>Interval</th>
                        <th>Ticket Price</th>
                        <th>House Edge</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {games.map(g => (
                        <tr key={g.id}>
                          <td>{g.id}</td>
                          <td><strong>{g.name}</strong></td>
                          <td>{g.draw_interval_ms / 1000}s</td>
                          <td>${g.ticket_price}</td>
                          <td>{(g.house_edge_percentage * 100).toFixed(0)}%</td>
                          <td className={g.status === 'ACTIVE' ? 'status-active' : 'status-paused'}>{g.status}</td>
                          <td>
                            <div className="table-actions">
                              <button onClick={() => startEditGame(g)} className="edit-btn">Edit</button>
                              <button onClick={() => toggleGameStatus(g)} className="status-toggle-btn">
                                {g.status === 'ACTIVE' ? 'Pause' : 'Activate'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: SPIN WHEEL MANAGEMENT */}
          {activeTab === 'spinwheel' && (
            <div className="workspace-flex">
              {/* Form panel */}
              <div className="editor-card">
                <h2>{editingPrize ? 'EDIT WHEEL SECTOR' : 'ADD WHEEL SECTOR'}</h2>
                <form onSubmit={handlePrizeSubmit} className="admin-form">
                  <div className="form-group">
                    <label>Prize Text (e.g., JACKPOT x5)</label>
                    <input 
                      type="text" 
                      placeholder="e.g., FREE $20" 
                      value={prizeFormData.text} 
                      onChange={e => setPrizeFormData({ ...prizeFormData, text: e.target.value })} 
                      required 
                    />
                  </div>
                  <div className="form-group inline-color-inputs">
                    <div>
                      <label>Background Color</label>
                      <input 
                        type="color" 
                        value={prizeFormData.color} 
                        onChange={e => setPrizeFormData({ ...prizeFormData, color: e.target.value })} 
                        required 
                      />
                    </div>
                    <div>
                      <label>Text Color</label>
                      <input 
                        type="color" 
                        value={prizeFormData.textColor} 
                        onChange={e => setPrizeFormData({ ...prizeFormData, textColor: e.target.value })} 
                        required 
                      />
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Payout Multiplier (x cost)</label>
                    <input 
                      type="number" 
                      step="0.1" 
                      value={prizeFormData.mult} 
                      onChange={e => setPrizeFormData({ ...prizeFormData, mult: parseFloat(e.target.value) })} 
                      required 
                    />
                  </div>
                  <div className="form-group checkbox-row">
                    <label className="checkbox-label">
                      <input 
                        type="checkbox" 
                        checked={prizeFormData.isBonus} 
                        onChange={e => setPrizeFormData({ ...prizeFormData, isBonus: e.target.checked })} 
                      />
                      <span>Is Bonus Offer (VIP/Cashback)</span>
                    </label>
                  </div>
                  <div className="button-group">
                    <button type="submit" className="primary-btn">{editingPrize ? 'UPDATE SECTOR' : 'ADD SECTOR'}</button>
                    {editingPrize && <button type="button" onClick={resetPrizeForm} className="secondary-btn">CANCEL</button>}
                  </div>
                </form>

                {/* Real-time preview canvas wheel nested directly inside the dashboard editor */}
                <div className="wheel-preview-box">
                  <h3>LIVE WHEEL PREVIEW</h3>
                  <div className="canvas-wrapper">
                    <canvas ref={canvasRef} width={200} height={200} className="admin-wheel-canvas" />
                  </div>
                </div>
              </div>

              {/* Data list panel */}
              <div className="data-table-card">
                <h2>SPIN WHEEL SECTOR CONFIGURATIONS</h2>
                {loadingPrizes ? <div className="loader">Loading sectors...</div> : (
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Prize Offer</th>
                        <th>Colors</th>
                        <th>Multiplier</th>
                        <th>Type</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prizes.map(p => (
                        <tr key={p.id}>
                          <td>{p.id}</td>
                          <td>
                            <span 
                              style={{ 
                                padding: '4px 8px', 
                                borderRadius: '4px', 
                                background: p.color, 
                                color: p.textColor, 
                                fontWeight: 'bold',
                                border: '1px solid rgba(255,255,255,0.1)'
                              }}
                            >
                              {p.text}
                            </span>
                          </td>
                          <td>
                            <div className="color-preview-dots">
                              <span title="Sector BG" style={{ background: p.color }} className="color-dot" />
                              <span title="Text Color" style={{ background: p.textColor }} className="color-dot" />
                            </div>
                          </td>
                          <td>x{p.mult}</td>
                          <td>
                            <span className={p.isBonus ? 'badge-bonus' : 'badge-regular'}>
                              {p.isBonus ? 'BONUS' : 'REGULAR'}
                            </span>
                          </td>
                          <td>
                            <div className="table-actions">
                              <button onClick={() => startEditPrize(p)} className="edit-btn">Edit</button>
                              <button onClick={() => handleDeletePrize(p.id)} className="delete-btn">Delete</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: CYBER SLOTS MANAGEMENT */}
          {activeTab === 'slots' && (
            <div className="workspace-flex">
              {/* Left Side: Strategy config panel */}
              <div className="editor-card">
                <h2>🎰 SLOTS STRATEGY ENGINE</h2>
                {loadingSlots ? <div className="loader">Loading slot config...</div> : (
                  <form onSubmit={handleSlotsSubmit} className="admin-form">
                    <div className="form-group">
                      <label>Payout Rules Strategy</label>
                      <select 
                        value={slotsConfig.payout_strategy}
                        onChange={e => setSlotsConfig({ ...slotsConfig, payout_strategy: e.target.value })}
                        className="strategy-dropdown"
                      >
                        <option value="FAIR_RNG">FAIR_RNG (Pure Weighted Probability)</option>
                        <option value="CONTROLLED_RTP">CONTROLLED_RTP (Dynamic House Edge)</option>
                        <option value="NEAR_MISS_TEASER">NEAR_MISS_TEASER (Excitement Optimizer)</option>
                      </select>
                      <div className="strategy-info-box">
                        {slotsConfig.payout_strategy === 'FAIR_RNG' && (
                          <p>💡 <strong>FAIR_RNG:</strong> Reels are spun strictly according to individual symbol probability weights. Long-term returns will naturally settle to weight ratios.</p>
                        )}
                        {slotsConfig.payout_strategy === 'CONTROLLED_RTP' && (
                          <p>⚠️ <strong>CONTROLLED_RTP:</strong> Rigged compliance. Tracks player lifetime bets vs won credits, forcing losses if current return rates exceed the target RTP.</p>
                        )}
                        {slotsConfig.payout_strategy === 'NEAR_MISS_TEASER' && (
                          <p>🚀 <strong>NEAR_MISS_TEASER:</strong> Boosts retention. Lost spins have a 50% probability to align two matching premium symbols, creating exciting teaser close calls.</p>
                        )}
                      </div>
                    </div>

                    <div className="form-group">
                      <label>Target RTP Rate (0.0 to 1.0)</label>
                      <input 
                        type="number" 
                        step="0.01" 
                        value={slotsConfig.target_rtp} 
                        onChange={e => setSlotsConfig({ ...slotsConfig, target_rtp: e.target.value })} 
                        required 
                        disabled={slotsConfig.payout_strategy !== 'CONTROLLED_RTP'}
                      />
                      <span className="input-helper-text">Configures payout limits for the CONTROLLED_RTP strategy. Default: 0.90 (90% Return-to-Player).</span>
                    </div>

                    <button type="submit" className="primary-btn">DEPLOY STRATEGY RULES</button>
                  </form>
                )}
              </div>

              {/* Right Side: Symbols configs */}
              <div className="data-table-card">
                <h2>🎰 REELS SYMBOLS WEIGHTS & MULTIPLIERS</h2>
                {loadingSlots ? <div className="loader">Loading symbols list...</div> : (
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Icon</th>
                        <th>Symbol</th>
                        <th>Payout Multiplier</th>
                        <th>Probability Weight</th>
                        <th>Hex Color</th>
                      </tr>
                    </thead>
                    <tbody>
                      {slotsSymbols.map((s, index) => {
                        const iconDetails = SYMBOL_MAP[s.name] || { emoji: '❓', label: s.name };
                        return (
                          <tr key={s.name}>
                            <td style={{ fontSize: '1.2rem' }}>{iconDetails.emoji}</td>
                            <td><strong>{s.name}</strong></td>
                            <td>
                              <input 
                                type="number" 
                                className="table-inline-input"
                                value={s.multiplier}
                                onChange={e => handleSymbolChange(index, 'multiplier', e.target.value)}
                              />
                            </td>
                            <td>
                              <input 
                                type="number" 
                                className="table-inline-input"
                                value={s.weight}
                                onChange={e => handleSymbolChange(index, 'weight', e.target.value)}
                              />
                            </td>
                            <td>
                              <div className="color-picker-cell">
                                <input 
                                  type="color" 
                                  value={s.color || '#ffffff'}
                                  onChange={e => handleSymbolChange(index, 'color', e.target.value)}
                                  className="table-color-input"
                                />
                                <span className="color-label">{s.color}</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                <div className="table-instructions">
                  💡 <strong>Multiplier:</strong> Configures payout multiple (e.g. 50x bet for 777). <br/>
                  💡 <strong>Weight:</strong> Higher weights increase roll probability.
                </div>
              </div>
            </div>
          )}

        </main>
      </div>
    </div>
  );
}

export default App;
