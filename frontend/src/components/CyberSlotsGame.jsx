import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';
import { API_BASE, apiFetch } from '../config';


const SYMBOL_MAP = {
  'BAR': { emoji: '➖', label: 'BAR', color: '#a5a2c2' },
  'CHERRY': { emoji: '🍒', label: 'CHERRY', color: '#ff0055' },
  'BELL': { emoji: '🔔', label: 'BELL', color: '#ffcc00' },
  'DIAMOND': { emoji: '💎', label: 'DIAMOND', color: '#00ffcc' },
  'SEVEN': { emoji: '7️⃣', label: 'SEVEN', color: '#b500ff' },
  'WILD': { emoji: '🎰', label: 'WILD', color: '#00ffcc' }
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
      const response = await apiFetch(`${API_BASE}/api/v1/slots/config`);
      const data = await response.json();
      if (true && data.config && data.config.symbols_config) {
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

    const socket = io(API_BASE);
    socket.on('lottery_events', (event) => {
      if (event.type === 'SLOTS_CONFIG_UPDATED') {
        console.log('[WS] Slots config updated. Refreshing payouts...');
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

    onBalanceUpdate(currentUser.balance - betSize);

    try {
      const response = await apiFetch(`${API_BASE}/api/v1/slots/spin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: currentUser.email, bet: betSize })
      });
      const data = await response.json();

      if (!response.ok ) {
        onBalanceUpdate(currentUser.balance);
        alert(data.message || 'Server connection error.');
        setIsSpinning(false);
        setSpinningReels([false, false, false]);
        return;
      }

      const targetReels = data.reels;
      const finalPayout = data.payout;
      const serverBalance = data.newBalance;

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

      setTimeout(() => {
        clearInterval(intervals[0]);
        setReels(prev => [targetReels[0], prev[1], prev[2]]);
        setSpinningReels(prev => [false, prev[1], prev[2]]);
      }, 1500);

      setTimeout(() => {
        clearInterval(intervals[1]);
        setReels(prev => [prev[0], targetReels[1], prev[2]]);
        setSpinningReels(prev => [prev[0], false, prev[2]]);
      }, 2300);

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
    <div className="slots-page-container">
      <div className="slots-main-layout">
        
        {/* Left Side: Game Machine */}
        <div className={`slots-machine-box ${flashWin ? 'jackpot-flash' : ''}`}>
          <div className="machine-header">
            <h2>CYBER SLOTS 777</h2>
            <div className="security-tag">🔐 SECURE DECENTRALIZED COMPLIANT</div>
          </div>

          {/* Reels Display */}
          <div className="reels-outer-container">
            <div className="reels-glass-overlay"></div>
            <div className="win-line-indicator"></div>
            
            <div className="reels-inner-grid">
              {reels.map((symbolKey, index) => {
                const sym = SYMBOL_MAP[symbolKey] || { emoji: '❓', label: symbolKey, color: '#fff' };
                const isReelSpinning = spinningReels[index];
                return (
                  <div key={index} className={`slots-reel ${isReelSpinning ? 'spinning-blur' : ''}`}>
                    <div className="reel-symbol-wrap" style={{ color: sym.color }}>
                      <span className="reel-emoji">{sym.emoji}</span>
                      <span className="reel-label">{sym.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Winning Screen Banner */}
          {winMessage && (
            <div className={`slots-result-banner ${payoutAmount > 0 ? 'win-banner' : 'lose-banner'}`}>
              {winMessage}
            </div>
          )}

          {/* Machine Controls */}
          <div className="slots-controls-wrapper">
            {/* Bet selector */}
            <div className="bet-select-group">
              <label>SELECT BET SIZE</label>
              <div className="bet-buttons">
                {[5, 10, 25, 50].map((size) => (
                  <button 
                    key={size}
                    type="button"
                    className={`bet-btn ${betSize === size ? 'active' : ''}`}
                    onClick={() => !isSpinning && setBetSize(size)}
                    disabled={isSpinning}
                  >
                    ${size}
                  </button>
                ))}
              </div>
            </div>

            <button 
              className="slots-spin-lever-btn" 
              onClick={startSlotsSpin} 
              disabled={isSpinning}
            >
              {isSpinning ? 'ROLLING...' : 'PULL LEVER 🚀'}
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
          </div>
        </div>
      </div>
    </div>
  );
}

export default CyberSlotsGame;
