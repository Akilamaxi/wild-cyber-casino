import React, { useState, useEffect } from 'react';

const SYMBOL_MAP = {
  'BAR': { emoji: '➖', label: 'BAR', color: '#a5a2c2' },
  'CHERRY': { emoji: '🍒', label: 'CHERRY', color: '#ff0055' },
  'BELL': { emoji: '🔔', label: 'BELL', color: '#ffcc00' },
  'DIAMOND': { emoji: '💎', label: 'DIAMOND', color: '#00ffcc' },
  'SEVEN': { emoji: '7️⃣', label: 'SEVEN', color: '#b500ff' },
  'WILD': { emoji: '🎰', label: 'WILD', color: '#00ffcc' }
};

const SYMBOLS_LIST = ['BAR', 'CHERRY', 'BELL', 'DIAMOND', 'SEVEN', 'WILD'];

function CyberSlotsGame({ currentUser, onBalanceUpdate }) {
  const [betSize, setBetSize] = useState(10);
  const [reels, setReels] = useState(['SEVEN', 'SEVEN', 'SEVEN']);
  const [isSpinning, setIsSpinning] = useState(false);
  const [spinningReels, setSpinningReels] = useState([false, false, false]);
  const [winMessage, setWinMessage] = useState('');
  const [payoutAmount, setPayoutAmount] = useState(0);

  // Sound/Vibration simulation (simple flashes)
  const [flashWin, setFlashWin] = useState(false);

  const startSlotsSpin = async () => {
    if (isSpinning) return;
    if (!currentUser) return;

    if (currentUser.balance < betSize) {
      alert("Insufficient funds for this bet size. Refill in the Wallet dashboard!");
      return;
    }

    // Reset messages
    setWinMessage('');
    setPayoutAmount(0);
    setFlashWin(false);
    setIsSpinning(true);
    setSpinningReels([true, true, true]);

    // Optimistically deduct the bet amount client-side
    onBalanceUpdate(currentUser.balance - betSize);

    try {
      // 1. Fetch spin result from secure backend
      const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:5000' : '';
      const response = await fetch(`${API_BASE}/api/slots/spin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: currentUser.email, bet: betSize })
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        // Revert balance on failure
        onBalanceUpdate(currentUser.balance);
        alert(data.error || 'Server connection error.');
        setIsSpinning(false);
        setSpinningReels([false, false, false]);
        return;
      }

      const targetReels = data.reels;
      const finalPayout = data.payout;
      const serverBalance = data.newBalance;

      // 2. Animate Reels Spinning
      // We run intervals to cycle through random symbols on each reel
      let intervals = [];
      
      const runReelCycle = (reelIndex) => {
        return setInterval(() => {
          setReels(prev => {
            const next = [...prev];
            const randomSym = SYMBOLS_LIST[Math.floor(Math.random() * SYMBOLS_LIST.length)];
            next[reelIndex] = randomSym;
            return next;
          });
        }, 70 + reelIndex * 20); // slightly offset interval speeds
      };

      intervals[0] = runReelCycle(0);
      intervals[1] = runReelCycle(1);
      intervals[2] = runReelCycle(2);

      // Stop Reels Sequentially
      // Reel 1 Stops at 1500ms
      setTimeout(() => {
        clearInterval(intervals[0]);
        setReels(prev => [targetReels[0], prev[1], prev[2]]);
        setSpinningReels(prev => [false, prev[1], prev[2]]);
      }, 1500);

      // Reel 2 Stops at 2300ms
      setTimeout(() => {
        clearInterval(intervals[1]);
        setReels(prev => [prev[0], targetReels[1], prev[2]]);
        setSpinningReels(prev => [prev[0], false, prev[2]]);
      }, 2300);

      // Reel 3 Stops at 3100ms
      setTimeout(() => {
        clearInterval(intervals[2]);
        setReels(prev => [prev[0], prev[1], targetReels[2]]);
        setSpinningReels([false, false, false]);

        // Complete Spin
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

    } catch (err) {
      console.error('Slots error:', err);
      onBalanceUpdate(currentUser.balance); // Revert balance
      setIsSpinning(false);
      setSpinningReels([false, false, false]);
      alert('Could not connect to slots backend.');
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
                const sym = SYMBOL_MAP[symbolKey];
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

            {/* Spin Lever button */}
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
            <div className="payout-row jackpot-row">
              <span className="payout-icons">🎰🎰🎰</span>
              <span className="payout-label">WILD JACKPOT</span>
              <span className="payout-mult">100x Bet</span>
            </div>
            <div className="payout-row seven-row">
              <span className="payout-icons">7️⃣7️⃣7️⃣</span>
              <span className="payout-label">LUCKY SEVENS</span>
              <span className="payout-mult">50x Bet</span>
            </div>
            <div className="payout-row diamond-row">
              <span className="payout-icons">💎💎💎</span>
              <span className="payout-label">CYBER DIAMONDS</span>
              <span className="payout-mult">20x Bet</span>
            </div>
            <div className="payout-row bell-row">
              <span className="payout-icons">🔔🔔🔔</span>
              <span className="payout-label">GOLD BELLS</span>
              <span className="payout-mult">10x Bet</span>
            </div>
            <div className="payout-row cherry-row">
              <span className="payout-icons">🍒🍒🍒</span>
              <span className="payout-label">NEON CHERRIES</span>
              <span className="payout-mult">5x Bet</span>
            </div>
            <div className="payout-row bar-row">
              <span className="payout-icons">➖➖➖</span>
              <span className="payout-label">CYBER BARS</span>
              <span className="payout-mult">3x Bet</span>
            </div>
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
