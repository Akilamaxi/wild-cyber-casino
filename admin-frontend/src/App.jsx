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
  const [activeTab, setActiveTab] = useState('lottery'); // 'lottery' | 'spinwheel' | 'slots' | 'dice' | 'crash'

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

  // --- Dice States ---
  const [diceConfig, setDiceConfig] = useState({
    mult_under_7: '2.3',
    mult_exact_7: '5.8',
    mult_over_7: '2.3',
    mult_doubles: '5.8'
  });
  const [tournamentsList, setTournamentsList] = useState([]);
  const [loadingDice, setLoadingDice] = useState(true);
  const [diceFormData, setDiceFormData] = useState({
    name: '', entry_fee: 10, prize_pool: 100, ends_at: ''
  });

  // --- Crash States ---
  const [crashConfig, setCrashConfig] = useState({
    lobby_time_ms: 5000,
    house_edge: 0.01,
    min_bet: 1,
    max_bet: 1000,
    max_multiplier: 10000,
    crash_delay_ms: 3000
  });
  const [loadingCrash, setLoadingCrash] = useState(true);

  // --- Plinko States ---
  const [plinkoConfig, setPlinkoConfig] = useState({
    house_edge: 0.05,
    min_bet: 1,
    max_bet: 1000,
    rtp_bias: 8,
    throw_out_chance: 0.02
  });
  const [loadingPlinko, setLoadingPlinko] = useState(true);

  // --- Affiliate States ---
  const [affiliateConfig, setAffiliateConfig] = useState({
    wager_commission_enabled: 'false',
    bounty_referrer_amount: '10',
    bounty_referee_free_drops: '10',
    min_deposit_threshold: '15',
    min_wager_threshold: '50'
  });
  const [shadowLogs, setShadowLogs] = useState([]);
  const [loadingAffiliate, setLoadingAffiliate] = useState(true);

  // Security & Risk Management state
  const [securityAlerts, setSecurityAlerts] = useState([]);
  const [bonusRules, setBonusRules] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [gameLogs, setGameLogs] = useState({ plinko: [], dice: [], crash: [] });
  
  // 360 player search email state
  const [searchPlayerEmail, setSearchPlayerEmail] = useState('');
  const [player360Data, setPlayer360Data] = useState(null);
  
  // Tag editing state
  const [tagInput, setTagInput] = useState('');
  
  // New rule builder form state
  const [ruleForm, setRuleForm] = useState({
    ruleName: '',
    triggerType: 'HOURLY_LOSS',
    threshold: '',
    rewardType: 'CASH',
    rewardAmount: ''
  });

  // Toast notification state
  const [toast, setToast] = useState({ show: false, msg: '', type: 'success' });
  const showToast = (msg, type = 'success') => {
    setToast({ show: true, msg, type });
    setTimeout(() => setToast({ show: false, msg: '', type: 'success' }), 4000);
  };

  // Affiliate performance stats
  const [affiliateStats, setAffiliateStats] = useState(null);

  const fetchSecurityData = async () => {
    try {
      const resAlerts = await fetch(`${API_BASE}/api/admin/security/alerts`);
      const dataAlerts = await resAlerts.json();
      if (dataAlerts.success) setSecurityAlerts(dataAlerts.alerts);

      const resRules = await fetch(`${API_BASE}/api/admin/bonus-rules`);
      const dataRules = await resRules.json();
      if (dataRules.success) setBonusRules(dataRules.rules);

      const resAudit = await fetch(`${API_BASE}/api/admin/audit-logs`);
      const dataAudit = await resAudit.json();
      if (dataAudit.success) setAuditLogs(dataAudit.logs);

      const resGames = await fetch(`${API_BASE}/api/admin/game-logs`);
      const dataGames = await resGames.json();
      if (dataGames.success) setGameLogs(dataGames);
    } catch (e) {
      console.error(e);
    }
  };

  const handleResolveAlert = async (alertId) => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/security/alerts/${alertId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminEmail: 'admin@test.com' })
      });
      const data = await res.json();
      if (data.success) {
        fetchSecurityData();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleUpdatePlayerStatus = async (email, status) => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${email}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, adminEmail: 'admin@test.com' })
      });
      const data = await res.json();
      if (data.success) {
        alert(`Player status updated to ${status}`);
        handlePlayerSearch(email);
        fetchSecurityData();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleUpdatePlayerTags = async (email, newTags) => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${email}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: newTags, adminEmail: 'admin@test.com' })
      });
      const data = await res.json();
      if (data.success) {
        alert('Player tags updated.');
        handlePlayerSearch(email);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleCreateRuleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/api/admin/bonus-rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ruleName: ruleForm.ruleName,
          triggerType: ruleForm.triggerType,
          threshold: ruleForm.threshold,
          rewardType: ruleForm.rewardType,
          rewardAmount: ruleForm.rewardAmount,
          adminEmail: 'admin@test.com'
        })
      });
      const data = await res.json();
      if (data.success) {
        alert('Rule created successfully.');
        setRuleForm({ ruleName: '', triggerType: 'HOURLY_LOSS', threshold: '', rewardType: 'CASH', rewardAmount: '' });
        fetchSecurityData();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleToggleRule = async (ruleId, active) => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/bonus-rules/${ruleId}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !active, adminEmail: 'admin@test.com' })
      });
      const data = await res.json();
      if (data.success) {
        fetchSecurityData();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handlePlayerSearch = async (email) => {
    if (!email) return;
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${encodeURIComponent(email)}/360-view`);
      const data = await res.json();
      if (data.success) {
        setPlayer360Data(data.user);
        setTagInput(data.user.tags ? data.user.tags.join(', ') : '');
      } else {
        alert(data.error || 'User not found.');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const canvasRef = useRef(null);
  const socketRef = useRef(null);

  // Load backend configurations
  useEffect(() => {
    if (currentUser && currentUser.role === 'ADMIN') {
      fetchGames();
      fetchPrizes();
      fetchSlotsConfig();
      fetchDiceAdminData();
      fetchCrashConfig();
      fetchPlinkoConfig();
      fetchAffiliateData();
      fetchSecurityData();

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
        if (event.type === 'DICE_CONFIG_UPDATED') {
          fetchDiceAdminData();
        }
        if (event.type === 'CRASH_CONFIG_UPDATED') {
          fetchCrashConfig();
        }
        if (event.type === 'PLINKO_CONFIG_UPDATED') {
          fetchPlinkoConfig();
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

  const fetchDiceAdminData = async () => {
    setLoadingDice(true);
    try {
      const resCfg = await fetch(`${API_BASE}/api/dice/config`);
      const dataCfg = await resCfg.json();
      if (dataCfg.success && dataCfg.config) {
        setDiceConfig(dataCfg.config);
      }

      const resTr = await fetch(`${API_BASE}/api/dice/tournaments`);
      const dataTr = await resTr.json();
      if (dataTr.success) {
        setTournamentsList(dataTr.tournaments);
      }
    } catch (err) {
      console.error(err);
    }
    setLoadingDice(false);
  };

  const fetchCrashConfig = async () => {
    setLoadingCrash(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/crash/config`);
      const data = await res.json();
      if (data.success && data.config) {
        setCrashConfig({
          lobby_time_ms: parseInt(data.config.lobby_time_ms, 10) || 5000,
          house_edge: parseFloat(data.config.house_edge) || 0.01,
          min_bet: parseFloat(data.config.min_bet) || 1,
          max_bet: parseFloat(data.config.max_bet) || 1000,
          max_multiplier: parseFloat(data.config.max_multiplier) || 10000,
          crash_delay_ms: parseInt(data.config.crash_delay_ms, 10) || 3000
        });
      }
    } catch (err) {
      console.error(err);
    }
    setLoadingCrash(false);
  };

  const fetchPlinkoConfig = async () => {
    setLoadingPlinko(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/plinko/config`);
      const data = await res.json();
      if (data.success && data.config) {
        setPlinkoConfig({
          house_edge: parseFloat(data.config.house_edge) || 0.05,
          min_bet: parseFloat(data.config.min_bet) || 1,
          max_bet: parseFloat(data.config.max_bet) || 1000,
          rtp_bias: parseInt(data.config.rtp_bias, 10) || 12,
          throw_out_chance: parseFloat(data.config.throw_out_chance) || 0.20
        });
      }
    } catch (err) {
      console.error(err);
    }
    setLoadingPlinko(false);
  };

  const handlePlinkoConfigSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/api/admin/plinko/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          house_edge: plinkoConfig.house_edge,
          min_bet: plinkoConfig.min_bet,
          max_bet: plinkoConfig.max_bet,
          rtp_bias: plinkoConfig.rtp_bias,
          throw_out_chance: plinkoConfig.throw_out_chance
        })
      });
      const data = await res.json();
      if (data.success) {
        alert('🎯 Plinko config deployed successfully!');
        fetchPlinkoConfig();
      } else {
        alert('Failed to update Plinko config');
      }
    } catch (err) {
      console.error(err);
      alert('Failed to update Plinko config');
    }
  };

  const fetchAffiliateData = async () => {
    setLoadingAffiliate(true);
    try {
      const resCfg = await fetch(`${API_BASE}/api/admin/affiliate/config`);
      const dataCfg = await resCfg.json();
      if (dataCfg.success && dataCfg.config) {
        setAffiliateConfig(dataCfg.config);
      }

      const resLogs = await fetch(`${API_BASE}/api/admin/affiliate/shadow-logs`);
      const dataLogs = await resLogs.json();
      if (dataLogs.success) {
        setShadowLogs(dataLogs.logs);
      }

      // Fetch affiliate performance stats
      try {
        const resStats = await fetch(`${API_BASE}/api/admin/affiliate/stats`);
        const dataStats = await resStats.json();
        if (dataStats.success) setAffiliateStats(dataStats.stats);
      } catch (_) { /* stats endpoint may not exist on older builds */ }
    } catch (err) {
      console.error(err);
    }
    setLoadingAffiliate(false);
  };

  const handleAffiliateConfigSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/api/admin/affiliate/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(affiliateConfig)
      });
      const data = await res.json();
      if (data.success) {
        showToast('🤝 Affiliate routing rules deployed successfully!');
        fetchAffiliateData();
      } else {
        showToast('Failed to update Affiliate settings: ' + data.error, 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Failed to update Affiliate settings.', 'error');
    }
  };

  const handleCrashConfigSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/api/admin/crash/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lobby_time_ms: crashConfig.lobby_time_ms,
          house_edge: crashConfig.house_edge,
          min_bet: crashConfig.min_bet,
          max_bet: crashConfig.max_bet,
          max_multiplier: crashConfig.max_multiplier,
          crash_delay_ms: crashConfig.crash_delay_ms
        })
      });
      const data = await res.json();
      if (data.success) {
        alert('🚀 Crash config deployed successfully!');
        fetchCrashConfig();
      } else {
        alert('Error: ' + data.error);
      }
    } catch (err) {
      alert('Failed to update config.');
    }
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

  // --- Dice Submit Operations ---
  const handleDiceConfigSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/api/admin/dice/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mult_under_7: parseFloat(diceConfig.mult_under_7),
          mult_exact_7: parseFloat(diceConfig.mult_exact_7),
          mult_over_7: parseFloat(diceConfig.mult_over_7),
          mult_doubles: parseFloat(diceConfig.mult_doubles)
        })
      });
      const data = await res.json();
      if (data.success) {
        alert('🎲 Dice multipliers updated successfully!');
        fetchDiceAdminData();
      } else {
        alert('Error: ' + data.error);
      }
    } catch (err) {
      alert('Failed to update config.');
    }
  };

  const handleCreateTournament = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/api/admin/dice/tournaments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(diceFormData)
      });
      const data = await res.json();
      if (data.success) {
        alert('🏆 New dice clash tournament spawned!');
        setDiceFormData({ name: '', entry_fee: 10, prize_pool: 100, ends_at: '' });
        fetchDiceAdminData();
      } else {
        alert('Error: ' + data.error);
      }
    } catch (err) {
      alert('Failed to create tournament');
    }
  };

  const handleCompleteTournament = async (id) => {
    if (!window.confirm('Complete this tournament? Top 3 leaderboard positions will be awarded payouts automatically.')) return;
    try {
      const res = await fetch(`${API_BASE}/api/admin/dice/tournaments/${id}/complete`, {
        method: 'POST'
      });
      const data = await res.json();
      if (data.success) {
        let msg = '🏆 Tournament Completed!\n\nPayouts distributed:\n';
        if (data.payouts && data.payouts.length > 0) {
          data.payouts.forEach(p => {
            msg += `- Rank ${p.rank}: ${p.email} won $${p.amount.toFixed(2)}\n`;
          });
        } else {
          msg += 'No participants joined; prize pool was not distributed.';
        }
        alert(msg);
        fetchDiceAdminData();
      } else {
        alert('Error: ' + data.error);
      }
    } catch (err) {
      alert('Failed to complete tournament');
    }
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
      {/* Global Toast Notification */}
      {toast.show && (
        <div style={{
          position: 'fixed', top: '20px', right: '24px', zIndex: 9999,
          background: toast.type === 'error' ? 'rgba(255,40,80,0.95)' : 'rgba(0,200,80,0.95)',
          color: '#fff', padding: '14px 22px', borderRadius: '10px',
          boxShadow: '0 4px 30px rgba(0,0,0,0.5)',
          fontFamily: 'Orbitron', fontSize: '13px', fontWeight: 'bold',
          letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '10px',
          animation: 'slideInRight 0.3s ease',
          maxWidth: '420px',
        }}>
          <span>{toast.type === 'error' ? '⚠️' : '✅'}</span>
          <span style={{ flex: 1 }}>{toast.msg}</span>
          <button onClick={() => setToast({ show: false, msg: '', type: 'success' })}
            style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '16px', lineHeight: 1 }}>✕</button>
        </div>
      )}
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
            <li>
              <button 
                onClick={() => setActiveTab('dice')} 
                className={`menu-btn ${activeTab === 'dice' ? 'active' : ''}`}
              >
                🎲 Dice Arena Controller
              </button>
            </li>
            <li>
              <button 
                onClick={() => setActiveTab('crash')} 
                className={`menu-btn ${activeTab === 'crash' ? 'active' : ''}`}
              >
                🚀 Crash Engine Control
              </button>
            </li>
            <li>
              <button 
                onClick={() => setActiveTab('plinko')} 
                className={`menu-btn ${activeTab === 'plinko' ? 'active' : ''}`}
              >
                🎯 Plinko RTP Control
              </button>
            </li>
            <li>
              <button 
                onClick={() => setActiveTab('affiliate')} 
                className={`menu-btn ${activeTab === 'affiliate' ? 'active' : ''}`}
              >
                🤝 Affiliate & Referrals
              </button>
            </li>
            <li>
              <button 
                onClick={() => setActiveTab('security')} 
                className={`menu-btn ${activeTab === 'security' ? 'active' : ''}`}
              >
                🛡️ Security & Risk Control
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

          {/* TAB 4: DICE ARENA CONTROLLER */}
          {activeTab === 'dice' && (
            <div className="workspace-flex">
              {/* Left Side: Create Tournaments & Edit Multipliers */}
              <div className="editor-card-holder" style={{ display: 'flex', flexDirection: 'column', gap: '30px', flex: 1 }}>
                
                {/* 1. Multipliers Form */}
                <div className="editor-card" style={{ maxWidth: '100%', width: '100%' }}>
                  <h2>🎲 DICE PAYOUT MULTIPLIERS</h2>
                  {loadingDice ? <div className="loader">Loading dice details...</div> : (
                    <form onSubmit={handleDiceConfigSubmit} className="admin-form">
                      <div className="form-group inline-color-inputs" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                        <div>
                          <label>Under 7 (Sum 2-6)</label>
                          <input 
                            type="number" 
                            step="0.1" 
                            value={diceConfig.mult_under_7} 
                            onChange={e => setDiceConfig({ ...diceConfig, mult_under_7: e.target.value })} 
                            required 
                          />
                        </div>
                        <div>
                          <label>Lucky 7 (Exact)</label>
                          <input 
                            type="number" 
                            step="0.1" 
                            value={diceConfig.mult_exact_7} 
                            onChange={e => setDiceConfig({ ...diceConfig, mult_exact_7: e.target.value })} 
                            required 
                          />
                        </div>
                      </div>
                      <div className="form-group inline-color-inputs" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginTop: '10px' }}>
                        <div>
                          <label>Over 7 (Sum 8-12)</label>
                          <input 
                            type="number" 
                            step="0.1" 
                            value={diceConfig.mult_over_7} 
                            onChange={e => setDiceConfig({ ...diceConfig, mult_over_7: e.target.value })} 
                            required 
                          />
                        </div>
                        <div>
                          <label>Doubles</label>
                          <input 
                            type="number" 
                            step="0.1" 
                            value={diceConfig.mult_doubles} 
                            onChange={e => setDiceConfig({ ...diceConfig, mult_doubles: e.target.value })} 
                            required 
                          />
                        </div>
                      </div>
                      <button type="submit" className="primary-btn" style={{ marginTop: '15px' }}>UPDATE MULTIPLIERS</button>
                    </form>
                  )}
                </div>

                {/* 2. Spawn Tournament Form */}
                <div className="editor-card" style={{ maxWidth: '100%', width: '100%' }}>
                  <h2>🏆 INITIALIZE DICE TOURNAMENT</h2>
                  <form onSubmit={handleCreateTournament} className="admin-form">
                    <div className="form-group">
                      <label>Tournament Name</label>
                      <input 
                        type="text" 
                        placeholder="e.g., Summer Dice Championship" 
                        value={diceFormData.name} 
                        onChange={e => setDiceFormData({ ...diceFormData, name: e.target.value })} 
                        required 
                      />
                    </div>
                    <div className="form-group inline-color-inputs" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                      <div>
                        <label>Entry Fee ($)</label>
                        <input 
                          type="number" 
                          value={diceFormData.entry_fee} 
                          onChange={e => setDiceFormData({ ...diceFormData, entry_fee: parseFloat(e.target.value) || 0 })} 
                          required 
                        />
                      </div>
                      <div>
                        <label>Initial Prize Pool ($)</label>
                        <input 
                          type="number" 
                          value={diceFormData.prize_pool} 
                          onChange={e => setDiceFormData({ ...diceFormData, prize_pool: parseFloat(e.target.value) || 0 })} 
                          required 
                        />
                      </div>
                    </div>

                    <div className="form-group" style={{ marginTop: '15px' }}>
                      <label>Tournament End Time (Ends At)</label>
                      <input 
                        type="datetime-local" 
                        value={diceFormData.ends_at} 
                        onChange={e => setDiceFormData({ ...diceFormData, ends_at: e.target.value })} 
                        required 
                      />
                      <span className="help-text">Select the exact date & time when the tournament will automatically end.</span>
                    </div>

                    <button type="submit" className="primary-btn" style={{ marginTop: '15px' }}>SPAWN TOURNAMENT</button>
                  </form>
                </div>
              </div>

              {/* Right Side: Tournaments list */}
              <div className="data-table-card" style={{ flex: 1.2 }}>
                <h2>DICE TOURNAMENTS LIST</h2>
                {loadingDice ? <div className="loader">Loading tournament configurations...</div> : (
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Name</th>
                        <th>Entry Fee</th>
                        <th>Prize Pool</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tournamentsList.map(t => (
                        <tr key={t.id}>
                          <td>{t.id}</td>
                          <td><strong>{t.name}</strong></td>
                          <td>${t.entry_fee}</td>
                          <td><strong>${t.prize_pool}</strong></td>
                          <td>
                            <span className={t.status === 'ACTIVE' ? 'status-active' : 'status-paused'}>
                              {t.status}
                            </span>
                          </td>
                          <td>
                            {t.status === 'ACTIVE' ? (
                              <button 
                                onClick={() => handleCompleteTournament(t.id)} 
                                className="delete-btn"
                                style={{ background: '#ff0055', color: '#fff', fontSize: '0.75rem', padding: '5px 10px', borderRadius: '4px', border: 'none', cursor: 'pointer' }}
                              >
                                Complete & Payout
                              </button>
                            ) : (
                              <span style={{ color: '#888', fontSize: '0.75rem' }}>Closed</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* TAB 5: CRASH MANAGEMENT */}
          {activeTab === 'crash' && (
            <div className="workspace-flex">
              <div className="editor-card">
                <h2>ROCKET CRASH ALGORITHM</h2>
                {loadingCrash ? <div className="loader">Loading...</div> : (
                  <form onSubmit={handleCrashConfigSubmit} className="admin-form">
                    <div className="form-group">
                      <label>Lobby Wait Time (ms)</label>
                      <input 
                        type="number" 
                        value={crashConfig.lobby_time_ms} 
                        onChange={e => setCrashConfig({ ...crashConfig, lobby_time_ms: parseInt(e.target.value) })} 
                        required 
                      />
                    </div>
                    <div className="form-group">
                      <label>House Edge (0.0 to 1.0)</label>
                      <input 
                        type="number" 
                        step="0.001" 
                        value={crashConfig.house_edge} 
                        onChange={e => setCrashConfig({ ...crashConfig, house_edge: parseFloat(e.target.value) })} 
                        required 
                      />
                      <small style={{display: 'block', marginTop: '5px', color: '#888'}}>
                        Example: 0.01 means 1% house edge. A higher edge causes earlier random crashes.
                      </small>
                    </div>
                    <div className="form-group inline-color-inputs" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                      <div className="form-group">
                        <label>Min Bet ($)</label>
                        <input type="number" step="1" value={crashConfig.min_bet} onChange={e => setCrashConfig({ ...crashConfig, min_bet: parseFloat(e.target.value) })} required />
                      </div>
                      <div className="form-group">
                        <label>Max Bet ($)</label>
                        <input type="number" step="1" value={crashConfig.max_bet} onChange={e => setCrashConfig({ ...crashConfig, max_bet: parseFloat(e.target.value) })} required />
                      </div>
                    </div>
                    <div className="form-group inline-color-inputs" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                      <div className="form-group">
                        <label>Max Multiplier Cap (x)</label>
                        <input type="number" step="1" value={crashConfig.max_multiplier} onChange={e => setCrashConfig({ ...crashConfig, max_multiplier: parseFloat(e.target.value) })} required />
                      </div>
                      <div className="form-group">
                        <label>Post-Crash Delay (ms)</label>
                        <input type="number" step="100" value={crashConfig.crash_delay_ms} onChange={e => setCrashConfig({ ...crashConfig, crash_delay_ms: parseInt(e.target.value) })} required />
                      </div>
                    </div>
                    <div className="button-group">
                      <button type="submit" className="primary-btn">UPDATE CRASH LOGIC</button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          )}

          {/* TAB 6: PLINKO MANAGEMENT */}
          {activeTab === 'plinko' && (
            <div className="admin-content-card">
              <div className="admin-card-header">
                <h2>PLINKO ALGORITHM & RTP CONTROL</h2>
                <span className="status-badge green">ACTIVE</span>
              </div>
              <div className="admin-card-body">
                {loadingPlinko ? <div className="loader">Loading...</div> : (
                  <form onSubmit={handlePlinkoConfigSubmit} className="admin-form">
                    <div className="form-grid">
                      <div className="form-group">
                        <label>House Edge (RTP Skew factor)</label>
                        <input 
                          type="number" 
                          step="0.01" 
                          value={plinkoConfig.house_edge} 
                          onChange={e => setPlinkoConfig({ ...plinkoConfig, house_edge: parseFloat(e.target.value) })} 
                          required 
                        />
                        <span className="help-text">Example: 0.05 represents a 5% target house edge.</span>
                      </div>
                      <div className="form-group">
                        <label>Center Bias Multiplier (Difficulty)</label>
                        <input 
                          type="number" 
                          step="1" 
                          value={plinkoConfig.rtp_bias} 
                          onChange={e => setPlinkoConfig({ ...plinkoConfig, rtp_bias: parseInt(e.target.value, 10) })} 
                          required 
                        />
                        <span className="help-text">Higher values (e.g. 10 - 25) pull the ball heavily to the center, making it a very hard game to win. Set to 0 for pure random mathematical distribution.</span>
                      </div>
                      <div className="form-group">
                        <label>Minimum Bet ($)</label>
                        <input 
                          type="number" 
                          step="1" 
                          value={plinkoConfig.min_bet} 
                          onChange={e => setPlinkoConfig({ ...plinkoConfig, min_bet: parseFloat(e.target.value) })} 
                          required 
                        />
                      </div>
                      <div className="form-group">
                        <label>Maximum Bet ($)</label>
                        <input 
                          type="number" 
                          step="1" 
                          value={plinkoConfig.max_bet} 
                          onChange={e => setPlinkoConfig({ ...plinkoConfig, max_bet: parseFloat(e.target.value) })} 
                          required 
                        />
                      </div>
                      <div className="form-group">
                        <label>Out of Bounds Throw-Out Chance (0.00 to 1.00)</label>
                        <input 
                          type="number" 
                          step="0.01" 
                          min="0"
                          max="1"
                          value={plinkoConfig.throw_out_chance} 
                          onChange={e => setPlinkoConfig({ ...plinkoConfig, throw_out_chance: parseFloat(e.target.value) })} 
                          required 
                        />
                        <span className="help-text">Probability that the ball flies off the sides of the board (results in 0x multiplier payout). Example: 0.20 means 20% of wagers will automatically be thrown out.</span>
                      </div>
                    </div>
                    <div className="button-group">
                      <button type="submit" className="primary-btn">UPDATE PLINKO CONFIG</button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          )}

          {/* TAB 7: AFFILIATE & REFERRALS MANAGEMENT */}
          {activeTab === 'affiliate' && (
            <div className="admin-content-card">
              <div className="admin-card-header">
                <div>
                  <h2>CYBER AFFILIATE &amp; ROUTING GATEKEEPER</h2>
                  <p style={{ fontSize: '12px', color: '#8b8493', margin: '4px 0 0 0' }}>Commission routing, referral bounties, shadow-mode analytics and live network performance.</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span className="status-badge green">SYSTEM LIVE</span>
                  <button onClick={fetchAffiliateData} className="primary-btn" style={{ padding: '6px 14px', fontSize: '11px', background: 'rgba(0,255,204,0.1)', border: '1px solid rgba(0,255,204,0.3)', color: '#00ffcc' }}>↻ REFRESH</button>
                </div>
              </div>
              <div className="admin-card-body">
                {loadingAffiliate ? <div className="loader">Loading...</div> : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>

                    {/* Performance Stats Row */}
                    {affiliateStats && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px' }}>
                        {[
                          { label: 'Total Referrals', value: affiliateStats.totalReferrals, color: '#00ccff' },
                          { label: 'Conversions', value: affiliateStats.completedReferrals, color: '#00ff66' },
                          { label: 'Conversion Rate', value: `${affiliateStats.conversionRate}%`, color: '#ffaa00' },
                          { label: 'Commissions Paid', value: `$${affiliateStats.totalCommissionsPaid}`, color: '#ff66cc' },
                          { label: 'Shadow Logged', value: `$${affiliateStats.shadowLoggedCommissions}`, color: '#aaaaff' },
                        ].map(stat => (
                          <div key={stat.label} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '14px 16px' }}>
                            <div style={{ fontSize: '10px', color: '#888', fontFamily: 'Orbitron', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' }}>{stat.label}</div>
                            <div style={{ fontSize: '1.4rem', fontFamily: 'Orbitron', fontWeight: 'bold', color: stat.color }}>{stat.value}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Settings Form */}
                    <form onSubmit={handleAffiliateConfigSubmit} className="admin-form">
                      <h3>System Configuration Parameters</h3>
                      <div className="form-grid">
                        <div className="form-group">
                          <label>Dynamic Feature Flag: Wager Commission Payouts</label>
                          <select
                            value={affiliateConfig.wager_commission_enabled}
                            onChange={e => setAffiliateConfig({ ...affiliateConfig, wager_commission_enabled: e.target.value })}
                            required
                          >
                            <option value="true">ACTIVE (Pay Commission to Wallets)</option>
                            <option value="false">SHADOW MODE (Log Calculations to Analytics)</option>
                          </select>
                          <span className="help-text">Active mode routes payouts immediately. Shadow mode acts as an internal marketing check.</span>
                        </div>
                        <div className="form-group">
                          <label>Bounty: Referrer Reward Amount ($)</label>
                          <input type="number" step="1" value={affiliateConfig.bounty_referrer_amount}
                            onChange={e => setAffiliateConfig({ ...affiliateConfig, bounty_referrer_amount: e.target.value })} required />
                        </div>
                        <div className="form-group">
                          <label>Bounty: Referee Free Drops</label>
                          <input type="number" step="1" value={affiliateConfig.bounty_referee_free_drops}
                            onChange={e => setAffiliateConfig({ ...affiliateConfig, bounty_referee_free_drops: e.target.value })} required />
                        </div>
                        <div className="form-group">
                          <label>Welcome Threshold: Min Deposit ($)</label>
                          <input type="number" step="1" value={affiliateConfig.min_deposit_threshold}
                            onChange={e => setAffiliateConfig({ ...affiliateConfig, min_deposit_threshold: e.target.value })} required />
                        </div>
                        <div className="form-group">
                          <label>Welcome Threshold: Min Wager Volume ($)</label>
                          <input type="number" step="1" value={affiliateConfig.min_wager_threshold}
                            onChange={e => setAffiliateConfig({ ...affiliateConfig, min_wager_threshold: e.target.value })} required />
                        </div>
                      </div>
                      <div className="button-group" style={{ marginTop: '20px' }}>
                        <button type="submit" className="primary-btn">SAVE AFFILIATE ROUTING RULES</button>
                      </div>
                    </form>

                    {/* Shadow Logs Panel */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <h3 style={{ margin: 0 }}>Shadow Mode Commission Logs</h3>
                        <span style={{ fontSize: '11px', color: '#666' }}>{shadowLogs.length} records</span>
                      </div>
                      <div className="table-responsive">
                        <table className="admin-table">
                          <thead>
                            <tr>
                              <th>ID</th>
                              <th>Referee Email</th>
                              <th>Referrer Email</th>
                              <th>Wager Amount</th>
                              <th>Potential Commission</th>
                              <th>Timestamp</th>
                            </tr>
                          </thead>
                          <tbody>
                            {shadowLogs.length === 0 ? (
                              <tr>
                                <td colSpan="6" style={{ textAlign: 'center', padding: '15px 0', color: '#555' }}>No shadow logs generated yet. Ensure feature flag is set to SHADOW MODE.</td>
                              </tr>
                            ) : (
                              shadowLogs.map(log => (
                                <tr key={log.id}>
                                  <td>{log.id}</td>
                                  <td>{log.referee_email}</td>
                                  <td>{log.referrer_email}</td>
                                  <td>${(parseFloat(log.wager_amount) || 0).toFixed(2)}</td>
                                  <td style={{ color: '#00ff66' }}>${(parseFloat(log.potential_commission) || 0).toFixed(4)}</td>
                                  <td>{new Date(log.timestamp).toLocaleString()}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Affiliate Config Change Audit Trail */}
                    <div>
                      <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '8px', color: '#00ffcc' }}>Recent Config Changes (Audit Trail)</h3>
                      <div style={{ maxHeight: '180px', overflowY: 'auto', background: '#08050e', border: '1px solid #1a1523', borderRadius: '8px', padding: '12px' }}>
                        {auditLogs.filter(l => l.action && l.action.includes('AFFILIATE') || l.details?.toLowerCase().includes('affiliate') || l.details?.toLowerCase().includes('bounty') || l.details?.toLowerCase().includes('bonus')).length === 0 ? (
                          <div style={{ color: '#444', fontSize: '12px', padding: '8px 0' }}>No affiliate config changes logged yet.</div>
                        ) : (
                          auditLogs
                            .filter(l => l.action?.includes('AFFILIATE') || l.details?.toLowerCase().includes('affiliate') || l.details?.toLowerCase().includes('bounty') || l.details?.toLowerCase().includes('bonus'))
                            .map((log, idx) => (
                              <div key={idx} style={{ padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.03)', fontSize: '11px' }}>
                                <span style={{ color: '#ff3366' }}>[{log.action}]</span>{' '}
                                {log.details}{' '}by <span style={{ color: '#00ffcc' }}>{log.admin_email}</span>{' '}
                                <span style={{ color: '#555' }}>— {new Date(log.created_at).toLocaleString()}</span>
                              </div>
                            ))
                        )}
                      </div>
                    </div>

                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 8: SECURITY & RISK CONTROL PANEL */}
          {activeTab === 'security' && (
            <div className="admin-content-card">
              <div className="admin-card-header" style={{ background: 'linear-gradient(135deg, #1f122e 0%, #11091c 100%)', borderBottom: '1px solid rgba(255, 0, 85, 0.2)' }}>
                <div>
                  <h2 style={{ color: '#ff3366', textShadow: '0 0 10px rgba(255, 51, 102, 0.3)' }}>🛡️ SYSTEM RISK SHIELD & AUDITING GATEWAY</h2>
                  <p style={{ fontSize: '12px', color: '#8b8493', margin: '5px 0 0 0' }}>Real-time IP Travel speed violations, Multi-account Sybil matching, Rules engine and Audit logs.</p>
                </div>
                <span className="status-badge" style={{ background: 'rgba(255, 51, 102, 0.1)', color: '#ff3366', border: '1px solid rgba(255, 51, 102, 0.3)' }}>SHIELD ON</span>
              </div>
              
              <div className="admin-card-body" style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                
                {/* 1. Risk Alerts & Travel Violations */}
                <div>
                  <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px', color: '#ffaa00' }}>Active Security & Risk Alerts</h3>
                  <div className="table-responsive">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Player</th>
                          <th>Violation Type</th>
                          <th>Severity</th>
                          <th>Details</th>
                          <th>Status</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {securityAlerts.length === 0 ? (
                          <tr>
                            <td colSpan="7" style={{ textAlign: 'center', padding: '15px' }}>No active security flags reported. System is healthy.</td>
                          </tr>
                        ) : (
                          securityAlerts.map(alert => (
                            <tr key={alert.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                              <td>{alert.id}</td>
                              <td style={{ fontWeight: 'bold' }}>{alert.email}</td>
                              <td>
                                <span style={{ padding: '2px 8px', borderRadius: '4px', background: 'rgba(255,0,0,0.1)', color: '#ff4444', fontSize: '11px', fontWeight: 'bold' }}>
                                  {alert.alert_type}
                                </span>
                              </td>
                              <td>
                                <span style={{ color: alert.severity === 'HIGH' ? '#ff3333' : '#ffaa00', fontWeight: 'bold' }}>
                                  {alert.severity}
                                </span>
                              </td>
                              <td style={{ fontSize: '12px', maxWidth: '300px', whiteSpace: 'normal', wordBreak: 'break-all' }}>{alert.details}</td>
                              <td>{alert.resolved ? 'Resolved' : 'Active'}</td>
                              <td>
                                {!alert.resolved && (
                                  <button onClick={() => handleResolveAlert(alert.id)} className="primary-btn" style={{ padding: '4px 10px', fontSize: '11px', background: '#00cc66' }}>
                                    RESOLVE
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 2. Player 360 View */}
                <div>
                  <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px', color: '#00ccff' }}>360-Degree Player Profile Inspector</h3>
                  <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                    <input 
                      type="email" 
                      placeholder="Enter player email..." 
                      value={searchPlayerEmail} 
                      onChange={e => setSearchPlayerEmail(e.target.value)}
                      style={{ flex: 1, padding: '10px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '6px' }}
                    />
                    <button onClick={() => handlePlayerSearch(searchPlayerEmail)} className="primary-btn" style={{ background: '#00ccff', color: '#000' }}>INSPECT PLAYER</button>
                  </div>

                  {player360Data && (
                    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px' }}>
                        <div>
                          <label style={{ fontSize: '11px', color: '#888' }}>EMAIL / USERNAME</label>
                          <div style={{ fontWeight: 'bold' }}>{player360Data.email} ({player360Data.username})</div>
                        </div>
                        <div>
                          <label style={{ fontSize: '11px', color: '#888' }}>CURRENT BALANCE</label>
                          <div style={{ color: '#00ff66', fontWeight: 'bold' }}>${player360Data.balance.toFixed(2)}</div>
                        </div>
                        <div>
                          <label style={{ fontSize: '11px', color: '#888' }}>TOTAL GAMES / WON</label>
                          <div>{player360Data.gamesPlayed} plays / ${player360Data.totalWon.toFixed(2)} won</div>
                        </div>
                        <div>
                          <label style={{ fontSize: '11px', color: '#888' }}>ACCOUNT STATUS</label>
                          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                            <span style={{ fontWeight: 'bold', color: player360Data.status === 'ACTIVE' ? '#00ff66' : '#ff3366' }}>{player360Data.status}</span>
                            <select 
                              value={player360Data.status} 
                              onChange={e => handleUpdatePlayerStatus(player360Data.email, e.target.value)}
                              style={{ padding: '2px 5px', background: '#000', color: '#fff', border: '1px solid #333' }}
                            >
                              <option value="ACTIVE">ACTIVE</option>
                              <option value="FROZEN">FROZEN</option>
                              <option value="BANNED">BANNED</option>
                            </select>
                          </div>
                        </div>
                      </div>

                      {/* Tagging Section */}
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '15px' }}>
                        <label style={{ fontSize: '11px', color: '#888' }}>MANAGE PLAYER SEGMENTS / TAGS (Comma separated)</label>
                        <div style={{ display: 'flex', gap: '10px', marginTop: '5px' }}>
                          <input 
                            type="text" 
                            value={tagInput}
                            onChange={e => setTagInput(e.target.value)}
                            placeholder="e.g. VIP, HighRoller, SuspectedSybil"
                            style={{ flex: 1, padding: '8px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '6px' }}
                          />
                          <button 
                            onClick={() => handleUpdatePlayerTags(player360Data.email, tagInput.split(',').map(s => s.trim()).filter(Boolean))} 
                            className="primary-btn"
                          >
                            SAVE TAGS
                          </button>
                        </div>
                      </div>

                      {/* Recent Logs & Sessions for this player */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '15px' }}>
                        <div>
                          <h4 style={{ color: '#00ccff', marginBottom: '8px' }}>Active Geolocation Sessions</h4>
                          <div style={{ maxHeight: '150px', overflowY: 'auto', fontSize: '12px' }}>
                            {player360Data.sessions && player360Data.sessions.map((s, i) => (
                              <div key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', padding: '5px 0' }}>
                                🌐 {s.ip_address} | {s.country}-{s.city} | {new Date(s.created_at).toLocaleString()}
                              </div>
                            ))}
                          </div>
                        </div>
                        <div>
                          <h4 style={{ color: '#00ccff', marginBottom: '8px' }}>Recent Ledger Transactions</h4>
                          <div style={{ maxHeight: '150px', overflowY: 'auto', fontSize: '12px' }}>
                            {player360Data.transactions && player360Data.transactions.map((t, i) => (
                              <div key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', padding: '5px 0', display: 'flex', justifyContent: 'space-between' }}>
                                <span>💸 {t.type}</span>
                                <span style={{ color: t.amount >= 0 ? '#00ff66' : '#ff4444' }}>{t.amount >= 0 ? '+' : ''}${t.amount.toFixed(2)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* 3. Loyalty Rules Engine */}
                <div>
                  <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px', color: '#ff33bb' }}>Loyalty & Risk Rules Builder</h3>
                  <form onSubmit={handleCreateRuleSubmit} className="admin-form" style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.03)', padding: '15px', borderRadius: '8px', marginBottom: '20px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '15px' }}>
                      <div className="form-group">
                        <label>Rule Name</label>
                        <input type="text" value={ruleForm.ruleName} onChange={e => setRuleForm({ ...ruleForm, ruleName: e.target.value })} placeholder="e.g. Net Loss Guard" required />
                      </div>
                      <div className="form-group">
                        <label>Trigger Type</label>
                        <select value={ruleForm.triggerType} onChange={e => setRuleForm({ ...ruleForm, triggerType: e.target.value })}>
                          <option value="HOURLY_LOSS">Hourly Net Loss ($)</option>
                        </select>
                      </div>
                      <div className="form-group">
                        <label>Threshold ($)</label>
                        <input type="number" step="1" value={ruleForm.threshold} onChange={e => setRuleForm({ ...ruleForm, threshold: e.target.value })} required />
                      </div>
                      <div className="form-group">
                        <label>Reward Type</label>
                        <select value={ruleForm.rewardType} onChange={e => setRuleForm({ ...ruleForm, rewardType: e.target.value })}>
                          <option value="CASH">Direct Wallet Balance Credit ($)</option>
                          <option value="FREE_DROPS">Free Tourney Rolls / Drops</option>
                        </select>
                      </div>
                      <div className="form-group">
                        <label>Reward Value</label>
                        <input type="number" step="0.1" value={ruleForm.rewardAmount} onChange={e => setRuleForm({ ...ruleForm, rewardAmount: e.target.value })} required />
                      </div>
                    </div>
                    <button type="submit" className="primary-btn" style={{ marginTop: '15px', background: '#ff33bb', color: '#fff' }}>DEPLOY TRIGGER RULE</button>
                  </form>

                  <div className="table-responsive">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Rule Name</th>
                          <th>Trigger Type</th>
                          <th>Threshold</th>
                          <th>Bonus Reward</th>
                          <th>Status</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bonusRules.map(rule => {
                          const reward = JSON.parse(rule.bonus_reward);
                          return (
                            <tr key={rule.id}>
                              <td>{rule.id}</td>
                              <td style={{ fontWeight: 'bold' }}>{rule.rule_name}</td>
                              <td>{rule.trigger_type}</td>
                              <td>${rule.threshold}</td>
                              <td>{reward.type === 'CASH' ? `$${reward.amount} Cash` : `${reward.amount} Drops`}</td>
                              <td>{rule.active ? 'ACTIVE' : 'INACTIVE'}</td>
                              <td>
                                <button onClick={() => handleToggleRule(rule.id, rule.active)} className="primary-btn" style={{ padding: '4px 10px', fontSize: '11px', background: rule.active ? '#ff4444' : '#00ff66' }}>
                                  {rule.active ? 'DISABLE' : 'ENABLE'}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 4. Immutable Audit Logs & Raw cryptographic outcome streams */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
                  <div>
                    <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px', color: '#00ffcc' }}>Admin Audit Log Trail</h3>
                    <div style={{ maxHeight: '220px', overflowY: 'auto', fontSize: '11px', background: '#08050e', border: '1px solid #1a1523', padding: '10px', borderRadius: '6px' }}>
                      {auditLogs.length === 0 ? (
                        <div style={{ color: '#444', padding: '8px 0' }}>No admin actions recorded yet.</div>
                      ) : auditLogs.map((log, idx) => (
                        <div key={idx} style={{ padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                          <span style={{ color: '#ff3366', fontWeight: 'bold' }}>[{log.action}]</span>{' '}
                          {log.details}{log.target_email ? ` → ${log.target_email}` : ''}{' '}by{' '}
                          <span style={{ color: '#00ffcc' }}>{log.admin_email}</span>{' '}
                          <span style={{ color: '#444' }}>@ {new Date(log.created_at).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px', color: '#00ffcc' }}>Raw Game Out-stream Logs</h3>
                    <div style={{ maxHeight: '220px', overflowY: 'auto', fontSize: '11px', background: '#08050e', border: '1px solid #1a1523', padding: '10px', borderRadius: '6px' }}>
                      {(!gameLogs.plinko?.length && !gameLogs.crash?.length && !gameLogs.dice?.length && !gameLogs.slots?.length) && (
                        <div style={{ color: '#444', padding: '8px 0' }}>No game logs recorded yet.</div>
                      )}
                      {gameLogs.plinko?.map((l, i) => (
                        <div key={`p-${i}`} style={{ padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.02)', display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                          <span style={{ background: 'rgba(0,255,102,0.15)', color: '#00ff66', borderRadius: '3px', padding: '1px 5px', fontSize: '9px', fontWeight: 'bold', whiteSpace: 'nowrap', marginTop: '1px' }}>PLINKO</span>
                          <span style={{ color: '#aaa' }}>
                            {l.email} | {l.rows}R {l.risk} | {l.multiplier}x | ${(l.payout || 0).toFixed(2)} | Bin {l.destination_bin ?? '?'} | Seed: {(l.server_seed || '').substring(0, 8)}…
                          </span>
                        </div>
                      ))}
                      {gameLogs.crash?.map((l, i) => (
                        <div key={`c-${i}`} style={{ padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.02)', display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                          <span style={{ background: 'rgba(255,51,102,0.15)', color: '#ff3366', borderRadius: '3px', padding: '1px 5px', fontSize: '9px', fontWeight: 'bold', whiteSpace: 'nowrap', marginTop: '1px' }}>CRASH</span>
                          <span style={{ color: '#aaa' }}>Game #{l.id} | {l.crash_point}x | {l.status} | {new Date(l.created_at).toLocaleTimeString()}</span>
                        </div>
                      ))}
                      {gameLogs.dice?.map((l, i) => (
                        <div key={`d-${i}`} style={{ padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.02)', display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                          <span style={{ background: 'rgba(255,170,0,0.15)', color: '#ffaa00', borderRadius: '3px', padding: '1px 5px', fontSize: '9px', fontWeight: 'bold', whiteSpace: 'nowrap', marginTop: '1px' }}>DICE</span>
                          <span style={{ color: '#aaa' }}>Tournament: {l.name} | Fee ${l.entry_fee ?? '?'} | {l.status} | {new Date(l.created_at).toLocaleTimeString()}</span>
                        </div>
                      ))}
                      {gameLogs.slots?.map((l, i) => (
                        <div key={`s-${i}`} style={{ padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.02)', display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                          <span style={{ background: 'rgba(0,204,255,0.15)', color: '#00ccff', borderRadius: '3px', padding: '1px 5px', fontSize: '9px', fontWeight: 'bold', whiteSpace: 'nowrap', marginTop: '1px' }}>SLOTS</span>
                          <span style={{ color: '#aaa' }}>{l.email} | {l.type} | ${(Math.abs(l.amount) || 0).toFixed(2)} | Bal: ${(l.balance_after || 0).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
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
