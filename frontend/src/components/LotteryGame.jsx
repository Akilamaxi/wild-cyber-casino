import React, { useState } from 'react';

function LotteryGame({ currentUser, onBalanceUpdate }) {
  const [selectedNumbers, setSelectedNumbers] = useState([]);
  const [betSize, setBetSize] = useState(5);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawResults, setDrawResults] = useState([]); // 6 official numbers
  const [revealedBalls, setRevealedBalls] = useState([]); // numbers revealed so far during animation
  const [matchedNumbers, setMatchedNumbers] = useState([]);
  const [winMessage, setWinMessage] = useState('');
  const [payoutAmount, setPayoutAmount] = useState(0);

  const selectNumber = (num) => {
    if (isDrawing) return;
    if (selectedNumbers.includes(num)) {
      setSelectedNumbers(prev => prev.filter(n => n !== num));
    } else {
      if (selectedNumbers.length >= 6) {
        alert("You can only select up to 6 numbers per ticket!");
        return;
      }
      setSelectedNumbers(prev => [...prev, num].sort((a, b) => a - b));
    }
  };

  const handleQuickPick = () => {
    if (isDrawing) return;
    const quick = [];
    while (quick.length < 6) {
      const randomNum = Math.floor(Math.random() * 49) + 1;
      if (!quick.includes(randomNum)) {
        quick.push(randomNum);
      }
    }
    setSelectedNumbers(quick.sort((a, b) => a - b));
  };

  const handleClear = () => {
    if (isDrawing) return;
    setSelectedNumbers([]);
    setDrawResults([]);
    setRevealedBalls([]);
    setMatchedNumbers([]);
    setWinMessage('');
    setPayoutAmount(0);
  };

  const startLotteryDraw = async () => {
    if (isDrawing) return;
    if (selectedNumbers.length !== 6) {
      alert("Please select exactly 6 numbers first or click QUICK PICK!");
      return;
    }
    if (!currentUser) return;

    if (currentUser.balance < betSize) {
      alert("Insufficient funds for this ticket. Deposit cash or claim bonuses first!");
      return;
    }

    // Reset old displays
    setIsDrawing(true);
    setDrawResults([]);
    setRevealedBalls([]);
    setMatchedNumbers([]);
    setWinMessage('');
    setPayoutAmount(0);

    // Optimistically deduct bet cost
    onBalanceUpdate(currentUser.balance - betSize);

    try {
      // 1. Fetch drawing results from backend
      const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:5000' : '';
      const response = await fetch(`${API_BASE}/api/lottery/draw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: currentUser.email,
          bet: betSize,
          chosenNumbers: selectedNumbers
        })
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        onBalanceUpdate(currentUser.balance); // Revert balance
        alert(data.error || 'Server connection error.');
        setIsDrawing(false);
        return;
      }

      const officialDraw = data.drawNumbers;
      const matched = data.matchedNumbers;
      const payout = data.payout;
      const serverBalance = data.newBalance;

      setDrawResults(officialDraw);

      // 2. Animate Drawing Balls sequentially
      // We reveal one ball every 600ms to build suspense
      let revealed = [];
      for (let index = 0; index < officialDraw.length; index++) {
        await new Promise(resolve => setTimeout(resolve, 600));
        revealed.push(officialDraw[index]);
        setRevealedBalls([...revealed]);
      }

      // Complete Drawing
      setIsDrawing(false);
      setMatchedNumbers(matched);
      setPayoutAmount(payout);
      onBalanceUpdate(serverBalance);

      // Calculate matches count
      const matchCount = matched.length;
      if (payout > 0) {
        if (matchCount === 6) {
          setWinMessage(`🔥 GRAND LOTTERY JACKPOT: +$${payout}! 🔥`);
        } else if (matchCount === 5) {
          setWinMessage(`💎 MEGA MATCH: +$${payout}! 💎`);
        } else {
          setWinMessage(`🎰 WINNER: +$${payout} (${matchCount} Matches)! 🎰`);
        }
      } else {
        setWinMessage(`NO WIN (${matchCount} Match${matchCount === 1 ? '' : 'es'}). TRY ANOTHER TICKET!`);
      }

    } catch (err) {
      console.error('Lottery error:', err);
      onBalanceUpdate(currentUser.balance); // Revert balance
      setIsDrawing(false);
      alert('Could not connect to lottery backend.');
    }
  };

  return (
    <div className="lottery-page-container">
      <div className="lottery-main-layout">
        {/* Left Grid: Ticket selection */}
        <div className="lottery-ticket-box">
          <div className="ticket-header">
            <h2>CYBER LOTTERY 49</h2>
            <div className="security-tag">🔐 STATEFUL SECURE COMPLIANT DRAW</div>
          </div>

          <div className="ticket-helper-bar">
            <span>Select exactly 6 numbers: <strong>{selectedNumbers.length}/6</strong></span>
            <div className="ticket-quick-actions">
              <button onClick={handleQuickPick} disabled={isDrawing} className="quick-action-btn pick">✨ QUICK PICK</button>
              <button onClick={handleClear} disabled={isDrawing} className="quick-action-btn clear">✕ CLEAR</button>
            </div>
          </div>

          {/* 1 to 49 Number Grid */}
          <div className="lottery-numbers-grid">
            {Array.from({ length: 49 }, (_, i) => i + 1).map((num) => {
              const isSelected = selectedNumbers.includes(num);
              const isMatch = drawResults.length > 0 && drawResults.includes(num) && selectedNumbers.includes(num);
              return (
                <button
                  key={num}
                  type="button"
                  onClick={() => selectNumber(num)}
                  disabled={isDrawing}
                  className={`grid-number-btn ${isSelected ? 'selected' : ''} ${isMatch ? 'matched-glow' : ''}`}
                >
                  {num}
                </button>
              );
            })}
          </div>

          {/* Draw display shelf */}
          <div className="lottery-draw-results-shelf">
            <span className="draw-label-tag">OFFICIAL DRAW BALLS</span>
            <div className="draw-balls-row">
              {Array.from({ length: 6 }).map((_, index) => {
                const ballRevealed = revealedBalls.length > index;
                const value = ballRevealed ? revealedBalls[index] : '?';
                const isMatched = ballRevealed && selectedNumbers.includes(revealedBalls[index]);

                return (
                  <div 
                    key={index} 
                    className={`draw-ball ${ballRevealed ? 'revealed bounce-enter' : 'hidden-ball'} ${isDrawing && revealedBalls.length === index ? 'pulsing-loader' : ''} ${isMatched ? 'winner-ball' : ''}`}
                  >
                    <span>{value}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Results feedback banner */}
          {winMessage && (
            <div className={`lottery-result-banner ${payoutAmount > 0 ? 'win' : 'lose'}`}>
              {winMessage}
            </div>
          )}

          {/* Controls */}
          <div className="lottery-controls-row">
            <div className="lottery-bet-group">
              <label>TICKET VALUE</label>
              <div className="bet-toggles">
                <button onClick={() => !isDrawing && setBetSize(5)} disabled={isDrawing} className={`bet-toggle-btn ${betSize === 5 ? 'active' : ''}`}>$5</button>
                <button onClick={() => !isDrawing && setBetSize(10)} disabled={isDrawing} className={`bet-toggle-btn ${betSize === 10 ? 'active' : ''}`}>$10</button>
              </div>
            </div>

            <button 
              className="lottery-draw-action-btn"
              onClick={startLotteryDraw}
              disabled={isDrawing || selectedNumbers.length !== 6}
            >
              {isDrawing ? 'DRAWING BALLS...' : 'BUY TICKET & DRAW 🚀'}
            </button>
          </div>
        </div>

        {/* Right Panel: Multipliers */}
        <div className="lottery-payout-panel">
          <h3>MATCH MULTIPLIERS</h3>
          <div className="panel-divider"></div>

          <div className="payout-rows-list">
            <div className="payout-row jackpot-row">
              <span className="payout-icons">🟢🟢🟢🟢🟢🟢</span>
              <span className="payout-label">6 MATCHES</span>
              <span className="payout-mult">10,000x Bet</span>
            </div>
            <div className="payout-row seven-row">
              <span className="payout-icons">🟢🟢🟢🟢🟢⚪</span>
              <span className="payout-label">5 MATCHES</span>
              <span className="payout-mult">100x Bet</span>
            </div>
            <div className="payout-row diamond-row">
              <span className="payout-icons">🟢🟢🟢🟢⚪⚪</span>
              <span className="payout-label">4 MATCHES</span>
              <span className="payout-mult">10x Bet</span>
            </div>
            <div className="payout-row bell-row">
              <span className="payout-icons">🟢🟢🟢⚪⚪⚪</span>
              <span className="payout-label">3 MATCHES</span>
              <span className="payout-mult">2x Bet</span>
            </div>
            <div className="payout-row cherry-row">
              <span className="payout-icons">⚪⚪⚪⚪⚪⚪</span>
              <span className="payout-label">0-2 MATCHES</span>
              <span className="payout-mult">No Payout</span>
            </div>
          </div>

          <div className="lottery-rules-box">
            <h4>How to Play:</h4>
            <ol>
              <li>Select 6 numbers on the grid.</li>
              <li>Toggle ticket bet size ($5 or $10).</li>
              <li>Click BUY TICKET. The system draws 6 random balls.</li>
              <li>Match 3 or more numbers to collect multipliers!</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}

export default LotteryGame;
