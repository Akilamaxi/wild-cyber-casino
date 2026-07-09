import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';

const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:5000' : '';

const SYMBOL_MAP = {
  'BAR': { emoji: '➖', label: 'BAR', color: '#a5a2c2' },
  'CHERRY': { emoji: '🍒', label: 'NEON CHERRY', color: '#ff0055' },
  'BELL': { emoji: '🔔', label: 'GOLD BELL', color: '#ffcc00' },
  'DIAMOND': { emoji: '💎', label: 'CYBER DIAMOND', color: '#00ffcc' },
  'SEVEN': { emoji: '7️⃣', label: 'LUCKY SEVEN', color: '#b500ff' },
  'WILD': { emoji: '🎰', label: 'WILD JACKPOT', color: '#00ffcc' }
};

const FALLBACK_SYMBOLS = [
  { name: 'BAR', multiplier: 3, weight: 30 },
  { name: 'CHERRY', multiplier: 5, weight: 25 },
  { name: 'BELL', multiplier: 10, weight: 20 },
  { name: 'DIAMOND', multiplier: 20, weight: 15 },
  { name: 'SEVEN', multiplier: 50, weight: 8 },
  { name: 'WILD', multiplier: 100, weight: 2 }
];

function CyberSlotsGame({ currentUser, onBalanceUpdate }) {
  const [betSize, setBetSize] = useState(10);
  const [reels, setReels] = useState(['SEVEN', 'SEVEN', 'SEVEN']);
  const [isSpinning, setIsSpinning] = useState(false);
  const [spinningReels, setSpinningReels] = useState([false, false, false]);
  const [winMessage, setWinMessage] = useState('');
  const [payoutAmount, setPayoutAmount] = useState(0);
  const [flashWin, setFlashWin] = useState(false);
  const [symbols, setSymbols] = useState(FALLBACK_SYMBOLS);

  const fetchConfig = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/slots/config`);
      const data = await response.json();
      if (data.success && data.config && data.config.symbols_config) {
        const parsed = JSON.parse(data.config.symbols_config);
        if (parsed.length > 0) {
          setSymbols(parsed);
        }
      }
    } catch (err) {
      console.error('Failed to load slots config:', err);
    }
  };

  useEffect(() => {
    fetchConfig();

    // Listen to WebSocket configuration updates
    const socket = io(API_BASE);
    socket.on('lottery_events', (event) => {
      if (event.type === 'SLOTS_CONFIG_UPDATED') {
        console.log('[WS] Slots configuration updated. Refreshing payouts table...');
        fetchConfig();
      }
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const startSlotsSpin = async () => {
    if (isSpinning) return;
    if (!currentUser) return;

    if (currentUser.balance < betSize) {
      alert("Insufficient funds for this bet size. Refill in the Wallet dashboard!");
      return;
    }

    setWinMessage('');
    setPayoutAmount(0);
    setFlashWin(false);
    setIsSpinning(true);
    setSpinningReels([true, true, true]);

    // Optimistically deduct the bet amount client-side
    onBalanceUpdate(currentUser.balance - betSize);

    try {
      const response = await fetch(`${API_BASE}/api/slots/spin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: currentUser.email, bet: betSize })
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        onBalanceUpdate(currentUser.balance);
        alert(data.error || 'Server connection error.');
        setIsSpinning(false);
        setSpinningReels([false, false, false]);
        return;
      }

      const targetReels = data.reels;
      const finalPayout = data.payout;
      const serverBalance = data.newBalance;

      // Cycle reels animation using dynamic symbols
      let intervals = [];
      const symbolsList = symbols.map(s => s.name);
      
      const runReelCycle = (reelIndex) => {
        return setInterval(() => {
          setReels(prev => {
            const next = [...prev];
            const randomSym = symbolsList[Math.floor(Math.random() * symbolsList.length)];
            next[reelIndex] = randomSym;
            return next;
          });
        }, 70 + reelIndex * 20);
      };

      intervals[0] = runReelCycle(0);
      intervals[1] = runReelCycle(1);
      intervals[2] = runReelCycle(2);

      // Stop Reel 1 Stops at 1500ms
      setTimeout(() => {
        clearInterval(intervals[0]);
        setReels(prev => [targetReels[0], prev[1], prev[2]]);
        setSpinningReels(prev => [false, prev[1], prev[2]]);
      }, 1500);

      // Stop Reel 2 Stops at 2300ms
      setTimeout(() => {
        clearInterval(intervals[1]);
        setReels(prev => [prev[0], targetReels[1], prev[2]]);
        setSpinningReels(prev => [prev[0], false, prev[2]]);
      }, 2300);

      // Stop Reel 3 Stops at 3100ms
      setTimeout(() => {
        clearInterval(intervals[2]);
        setReels(prev => [prev[0], prev[1], targetReels[2]]);
        setSpinningReels([false, false, false]);

        setIsSpinning(false);
        onBalanceUpdate(serverBalance);

        if (finalPayout > 0) {
          setPayoutAmount(finalPayout);
          setFlashWin(true);
          if (finalPayout === betSize * 100) {
            setWinMessage(`🔥 GRAND JACKPOT WIN: +$${finalPayout}! 🔥`);
          } else if (finalPayout >= betSize * 10) {
            setWinMessage(`💎 MEGA WIN: +$${finalPayout}! 💎`);
          } else {
            setWinMessage(`🎰 WIN: +$${finalPayout}! 🎰`);
          }
        } else {
          setWinMessage('NO WIN. TRY AGAIN!');
        }
      }, 3100);

    } catch (error) {
      console.error("Slots connection failed:", error);
      alert("Could not connect to slots engine server.");
      onBalanceUpdate(currentUser.balance);
      setIsSpinning(false);
      setSpinningReels([false, false, false]);
    }
  };

  return (
    <div className="game-view-wrapper">
      <div className={`slots-game-container ${flashWin ? 'slots-win-flash' : ''}`}>
        
        {/* Left Side: Slots Machine reels & controls */}
        <div className="slots-machine-card">
          <div className="slots-header">
            <h2>CYBER SLOTS 777</h2>
            <p className="slots-subtitle">PROVABLY FAIR DECENTRALIZED COMPLIANT RNG</p>
          </div>

          {/* Slots Reels Display */}
          <div className="slots-window">
            <div className="winline-indicator"></div>
            <div className="reels-row">
              {reels.map((symbolName, idx) => {
                const s = SYMBOL_MAP[symbolName] || { emoji: '❓', label: symbolName, color: '#fff' };
                const isSpin = spinningReels[idx];
                return (
                  <div 
                    key={idx} 
                    className={`slots-reel-box ${isSpin ? 'reel-blur-anim' : ''}`}
                    style={{ borderTopColor: s.color }}
                  >
                    <span className="reel-emoji">{s.emoji}</span>
                    <span className="reel-label" style={{ color: s.color }}>{s.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Win popups */}
          {winMessage && (
            <div className={`slots-outcome-banner ${payoutAmount > 0 ? 'win' : 'lose'}`}>
              {winMessage}
            </div>
          )}

          {/* Spin controls */}
          <div className="slots-actions">
            <div className="bet-adjuster">
              <span className="bet-label">BET SIZE</span>
              <div className="bet-btn-row">
                <button disabled={isSpinning} onClick={() => setBetSize(Math.max(5, betSize - 5))}>-</button>
                <span className="bet-val">${betSize}</span>
                <button disabled={isSpinning} onClick={() => setBetSize(betSize + 5)}>+</button>
              </div>
            </div>

            <button 
              className="slots-spin-btn" 
              onClick={startSlotsSpin} 
              disabled={isSpinning}
            >
              {isSpinning ? 'SPINNING...' : '🎰 SPIN REELS'}
            </button>
          </div>
        </div>

        {/* Right Side: Multipliers Payout Table */}
        <div className="slots-payout-panel">
          <h3>PAYOUT MULTIPLIERS</h3>
          <div className="panel-divider"></div>
          
          <div className="payout-rows-list">
            {symbols.map(sym => {
              const details = SYMBOL_MAP[sym.name] || { emoji: '❓', label: sym.name };
              return (
                <div key={sym.name} className="payout-row">
                  <span className="payout-icons">
                    {details.emoji}{details.emoji}{details.emoji}
                  </span>
                  <span className="payout-label">{details.label}</span>
                  <span className="payout-mult">{sym.multiplier}x Bet</span>
                </div>
              );
            })}
            <div className="payout-row double-row">
              <span className="payout-icons">🔹🔹◽</span>
              <span className="payout-label">ANY 2 MATCHING</span>
              <span className="payout-mult">2x Bet</span>
            </div>
          </div>

          <div className="slots-game-info">
            ℹ️ Wild symbols 🎰 substitute for any symbol on the winline to complete winning sequences!
          </div>
        </div>
      </div>
    </div>
  );
}

export default CyberSlotsGame;
