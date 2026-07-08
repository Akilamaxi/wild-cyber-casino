import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';

const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:5000' : '';

const LOTTERY_GAMES = [
  { name: 'Sugar Rush 15', desc: 'Micro-draw; rapid turnover', bets: [5, 10], interval: '15 Min', badge: '⚡ FAST' },
  { name: 'Sweet Treat 30', desc: 'High-frequency accumulator', bets: [10, 25], interval: '30 Min', badge: '🔥 HOT' },
  { name: 'Glazed Gold', desc: 'Standard hourly jackpot', bets: [20, 50], interval: '1 Hour', badge: '⭐ hourly' },
  { name: 'The Daily Dollop', desc: 'Daily engagement anchor', bets: [50, 100], interval: '1 Day', badge: '🏆 DAILY' },
  { name: 'The Weekly Whiff', desc: 'Mid-tier anticipation event', bets: [100, 250], interval: '1 Week', badge: '💎 WEEKLY' },
  { name: 'The Grand Ganache', desc: 'High-stakes monthly draw', bets: [250, 500], interval: '1 Month', badge: '👑 MONTHLY' },
  { name: 'The Quarterly Banquet', desc: 'Massive seasonal jackpot', bets: [500, 1000], interval: '3 Months', badge: '🌟 MEGA' }
];

function LotteryGame({ currentUser, onBalanceUpdate }) {
  // Navigation State: null = Games Lobby, otherwise active game object
  const [selectedGame, setSelectedGame] = useState(null);
  
  const [selectedNumbers, setSelectedNumbers] = useState([]);
  const [betSize, setBetSize] = useState(5);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawResults, setDrawResults] = useState([]); // official numbers
  const [revealedBalls, setRevealedBalls] = useState([]); // animated reveals
  const [winMessage, setWinMessage] = useState('');
  const [payoutAmount, setPayoutAmount] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const [ticketHistory, setTicketHistory] = useState([]);
  
  // Real-Time States
  const [activeDrawId, setActiveDrawId] = useState(null);
  const [drawState, setDrawState] = useState('OPEN'); // OPEN, LOCKED, DRAWING, COMPLETED
  const [myTickets, setMyTickets] = useState([]);
  const [countdown, setCountdown] = useState(30);

  // Background Toasts Alerts
  const [toasts, setToasts] = useState([]);
  const socketRef = useRef(null);

  // Reset bet sizes and ticket board when active game changes
  useEffect(() => {
    if (selectedGame) {
      setBetSize(selectedGame.bets[0]);
      handleClear();
      fetchStatus(selectedGame.name);
    }
  }, [selectedGame]);

  // Load status on mount and connect WebSockets
  useEffect(() => {
    const targetGameName = selectedGame ? selectedGame.name : 'Sugar Rush 15';
    fetchStatus(targetGameName);
    
    // Connect WebSockets to unified API server
    socketRef.current = io(API_BASE);

    socketRef.current.on('connect', () => {
      console.log('[WS] Connected to lottery websocket engine.');
      socketRef.current.emit('request_initial_state');
    });

    socketRef.current.on('lottery_events', async (event) => {
      console.log('[WS] Multi-game Event received:', event);

      // 1. Event belongs to the active selected game
      if (selectedGame && event.lotteryName === selectedGame.name) {
        if (event.type === 'DRAW_STATE_CHANGED') {
          setDrawState(event.state);
          if (event.state === 'LOCKED' || event.state === 'DRAWING') {
            setIsDrawing(true);
          } else if (event.state === 'OPEN') {
            setIsDrawing(false);
            setDrawState('OPEN');
          }
        } else if (event.type === 'DRAW_COMPLETED') {
          setDrawState('COMPLETED');
          setIsDrawing(true);
          setDrawResults(event.winningNumbers);
          
          // Trigger sequential ball reveal animation
          let revealed = [];
          for (let i = 0; i < event.winningNumbers.length; i++) {
            await new Promise(resolve => setTimeout(resolve, 600));
            revealed.push(event.winningNumbers[i]);
            setRevealedBalls([...revealed]);
          }

          // Complete reveal sequence
          await new Promise(resolve => setTimeout(resolve, 500));
          setIsDrawing(false);
          setCountdown(30); // Reset local timer

          // Re-fetch status to update wallet balance and tickets payouts
          fetchStatus(selectedGame.name);
          
          // Calculate matches and display banner
          if (currentUser) {
            let totalWonThisDraw = 0;
            let bestMatchCount = 0;

            myTickets.forEach(t => {
              const matches = t.chosenNumbers.filter(n => event.winningNumbers.includes(n));
              bestMatchCount = Math.max(bestMatchCount, matches.length);
              
              let mult = 0;
              if (matches.length === 3) mult = 2;
              else if (matches.length === 4) mult = 10;
              else if (matches.length === 5) mult = 100;
              else if (matches.length === 6) mult = 10000;
              
              totalWonThisDraw += t.betAmount * mult;
            });

            if (totalWonThisDraw > 0) {
              setPayoutAmount(totalWonThisDraw);
              setWinMessage(`🎉 YOU WON $${totalWonThisDraw} on ${selectedGame.name} (Max Match: ${bestMatchCount} numbers)! 🎉`);
            } else {
              setWinMessage(`NO WIN on ${selectedGame.name} (Max Match: ${bestMatchCount} numbers). Try another ticket!`);
            }
          }
        }
      } 
      // 2. Event belongs to background game - trigger top Toast Notification
      else if (event.type === 'DRAW_COMPLETED') {
        const matchingGame = LOTTERY_GAMES.find(g => g.name === event.lotteryName);
        const nameLabel = matchingGame ? matchingGame.name : event.lotteryName;
        addToast(`📢 DRAW COMPLETED: ${nameLabel} winning balls: [${event.winningNumbers.join(', ')}]!`);
      }
    });

    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, [currentUser, selectedGame, myTickets]);

  // Visual countdown ticker timer
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) return 30;
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const addToast = (msg) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, text: msg }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 6000); // disappear after 6 seconds
  };

  const fetchStatus = async (gameName) => {
    try {
      const emailParam = currentUser ? `&email=${currentUser.email}` : '';
      const response = await fetch(`${API_BASE}/api/lottery/status?lotteryName=${encodeURIComponent(gameName)}${emailParam}`);
      const data = await response.json();
      if (data.success) {
        if (selectedGame && gameName === selectedGame.name) {
          setActiveDrawId(data.draw.id);
          setDrawState(data.draw.state);
          setMyTickets(data.tickets || []);
        }
        
        // Sync user balance with DB
        if (currentUser) {
          const walletRes = await fetch(`${API_BASE}/api/user/wallet?email=${currentUser.email}`);
          const walletData = await walletRes.json();
          if (walletData.success) {
            onBalanceUpdate(walletData.balance);
          }
        }
      }
    } catch (err) {
      console.error('Failed to sync lottery status:', err);
    }
  };

  const fetchHistory = async () => {
    if (!currentUser) return;
    try {
      const response = await fetch(`${API_BASE}/api/lottery/history?email=${currentUser.email}`);
      const data = await response.json();
      if (data.success) {
        setTicketHistory(data.tickets);
        setShowHistory(true);
      }
    } catch (err) {
      console.error('Failed to fetch ticket history:', err);
    }
  };

  const selectNumber = (num) => {
    if (isDrawing || drawState !== 'OPEN') return;
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
    if (isDrawing || drawState !== 'OPEN') return;
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
    if (isDrawing || drawState !== 'OPEN') return;
    setSelectedNumbers([]);
    setDrawResults([]);
    setRevealedBalls([]);
    setWinMessage('');
    setPayoutAmount(0);
  };

  const buyTicket = async () => {
    if (!selectedGame || isDrawing || drawState !== 'OPEN') return;
    if (selectedNumbers.length !== 6) {
      alert("Please select exactly 6 numbers first or click QUICK PICK!");
      return;
    }
    if (!currentUser) return;

    if (currentUser.balance < betSize) {
      alert("Insufficient funds for this ticket. Deposit cash inside your Wallet first!");
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/lottery/buy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: currentUser.email,
          bet: betSize,
          chosenNumbers: selectedNumbers,
          lotteryName: selectedGame.name
        })
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        alert(data.error || 'Server rejected ticket purchase.');
        return;
      }

      alert(`Ticket registered successfully for ${selectedGame.name} (Draw #${data.drawId})!`);
      setSelectedNumbers([]);
      fetchStatus(selectedGame.name); // Reload tickets list
    } catch (err) {
      console.error('Lottery purchase error:', err);
      alert('Could not connect to lottery API.');
    }
  };

  // ============================================================================
  // RENDER VIEW A: TICKET HISTORY
  // ============================================================================
  if (showHistory) {
    return (
      <div className="lottery-page-container">
        <div className="lottery-navigation-banner">
          <button className="back-lobby-btn" onClick={() => setShowHistory(false)}>
            ← BACK TO LOBBY
          </button>
          <div className="nav-details">
            <span><strong>TICKET HISTORY</strong></span>
          </div>
        </div>
        <div className="lottery-active-tickets-shelf-bottom" style={{ marginTop: '0' }}>
          <h4>MY TICKET HISTORY</h4>
          <div className="panel-divider"></div>
          {ticketHistory.length === 0 ? (
             <p className="no-tickets-tag">No tickets found in your history.</p>
          ) : (
             <div className="tickets-grid">
                {ticketHistory.map(t => {
                  const isDrawComplete = t.drawState === 'COMPLETED';
                  const isWin = t.payout > 0;
                  const matchesCount = t.winningNumbers ? t.chosenNumbers.filter(n => t.winningNumbers.includes(n)).length : null;
                  
                  return (
                    <div key={t.id} className={`ticket-row-card ${isWin ? 'won' : ''}`}>
                      <div className="ticket-card-header">
                        <span className="card-logo">{t.lotteryName.toUpperCase()}</span>
                        <span className="card-tx-id">#{t.id} - Draw #{t.drawId}</span>
                      </div>
                      <div className="ticket-card-numbers">
                        {t.chosenNumbers.map(n => {
                          const matched = t.winningNumbers && t.winningNumbers.includes(n);
                          return <span key={n} className={`ticket-card-num-badge ${matched ? 'matched' : ''}`}>{n}</span>;
                        })}
                      </div>
                      <div className="ticket-card-meta">
                        <span>Bet: ${t.betAmount}</span>
                        <span style={{ fontSize: '0.75rem', color: '#888' }}>{new Date(t.timestamp).toLocaleString()}</span>
                      </div>
                      <div className="ticket-card-meta" style={{ marginTop: '8px' }}>
                        {isDrawComplete ? (
                          isWin ? (
                            <span className="ticket-status-label font-gold">Matched {matchesCount} (+${t.payout})</span>
                          ) : (
                            <span className="ticket-status-label font-gray">LOSS</span>
                          )
                        ) : (
                          <span className="ticket-status-label font-gray">PENDING DRAW ⏱️</span>
                        )}
                      </div>
                      <div className="ticket-barcode">
                        <div className="barcode-strip"></div>
                        <div className="barcode-numbers">49-CYBER-TICKET-{t.id}</div>
                      </div>
                    </div>
                  );
                })}
             </div>
          )}
        </div>
      </div>
    );
  }

  // ============================================================================
  // RENDER VIEW B: LOTTERY GAMES LOBBY (Default View)
  // ============================================================================
  if (!selectedGame) {
    return (
      <div className="lottery-page-container">
        {/* Toast Overlay Container */}
        <div className="lottery-toasts-container">
          {toasts.map(toast => (
            <div key={toast.id} className="lottery-toast-alert slide-in">
              <span className="toast-icon">📢</span>
              <span className="toast-text">{toast.text}</span>
            </div>
          ))}
        </div>

        {/* CSS-Based High-Fidelity 3D Neon Hero Banner */}
        <div className="lottery-hero-banner">
          <div className="hero-balls-decoration">
            <div className="deco-ball ball-1">9</div>
            <div className="deco-ball ball-2">3</div>
            <div className="deco-ball ball-3">5</div>
            <div className="deco-ball ball-4">18</div>
            <div className="deco-ball ball-5">42</div>
          </div>
          <div className="hero-banner-content">
            <span className="hero-subtitle">CYBERPUNK CASINO DRAW GAMES</span>
            <h1>MEGA LOTTERY 49</h1>
            <p>State-of-the-art cryptographic draws powered by SHA-256 server-side seeds. Choose 6 numbers, match them, and credit your balance instantly.</p>
            <div className="hero-badges">
              <span className="hero-badge-item">🛡️ Provably Fair</span>
              <span className="hero-badge-item">⚡ Instant Payouts</span>
              <span className="hero-badge-item">🔐 Ledger Verified</span>
            </div>
          </div>
          <div className="hero-ticket-illustration">
            <div className="illust-ticket blue-ticket">
              <div className="ticket-title-illust">TICKET</div>
              <div className="ticket-dots-illust">● ● ● ●</div>
            </div>
            <div className="illust-ticket red-ticket">
              <div className="ticket-title-illust">LOTTO</div>
              <div className="ticket-dots-illust">9 3 5</div>
            </div>
          </div>
        </div>

        <div className="lottery-lobby-header">
          <h2>CYBER LOTTERY DRAW GAMES</h2>
          <p className="panel-subtitle">Select a draw game from our premium pool to buy tickets and join live drawings.</p>
          <div className="section-divider"></div>
          {currentUser && (
            <button className="history-btn" onClick={() => fetchHistory()}>
              📜 MY TICKET HISTORY
            </button>
          )}
        </div>

        {/* Games Selector Grid (Arranged in Rows and Columns Grid Mode) */}
        <div className="lottery-lobby-grid">
          {LOTTERY_GAMES.map(game => (
            <div 
              key={game.name} 
              className="lottery-lobby-card"
              onClick={() => setSelectedGame(game)}
            >
              <div className="lottery-badge-wrap">
                <span className="lottery-card-badge">{game.badge}</span>
              </div>
              <div className="lottery-card-main">
                <h3>{game.name}</h3>
                <p className="lottery-card-desc">{game.desc}</p>
              </div>
              <div className="lottery-card-footer">
                <div className="info-stat">
                  <span className="info-label">DRAW TIMELINE</span>
                  <span className="info-value">⏱️ {game.interval}</span>
                </div>
                <div className="info-stat">
                  <span className="info-label">WAGER LIMITS</span>
                  <span className="info-value">${game.bets[0]} - ${game.bets[1]}</span>
                </div>
              </div>
              <button className="lottery-play-now-btn">PLAY TICKET 🚀</button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ============================================================================
  // RENDER VIEW B: TICKET PURCHASING & DRAW VIEW
  // ============================================================================
  return (
    <div className="lottery-page-container">
      {/* Toast Overlay Container */}
      <div className="lottery-toasts-container">
        {toasts.map(toast => (
          <div key={toast.id} className="lottery-toast-alert slide-in">
            <span className="toast-icon">📢</span>
            <span className="toast-text">{toast.text}</span>
          </div>
        ))}
      </div>

      {/* Back and Status Navigation Bar */}
      <div className="lottery-navigation-banner">
        <button className="back-lobby-btn" onClick={() => setSelectedGame(null)}>
          ← BACK TO GAMES
        </button>
        <div className="nav-details">
          <span>ACTIVE SESSION: <strong>#{activeDrawId || '...'}</strong></span>
          <span className="divider-dot">•</span>
          <span>GAME: <strong>{selectedGame.name.toUpperCase()}</strong></span>
          <span className="divider-dot">•</span>
          <span>STATUS: <strong className={`status-${drawState.toLowerCase()}`}>{drawState}</strong></span>
          <span className="divider-dot">•</span>
          <span>NEXT DRAW IN: <strong>{isDrawing ? 'DRAWING...' : `${countdown}s`}</strong></span>
        </div>
      </div>

      <div className="lottery-main-layout">
        {/* Left Grid: Ticket selection */}
        <div className="lottery-ticket-box">
          <div className="ticket-header">
            <h2>{selectedGame.name.toUpperCase()} TICKET</h2>
            <div className="security-tag">🔐 cryptographically secure hm-sha256 engine</div>
          </div>

          <div className="ticket-helper-bar">
            <span>Select exactly 6 numbers: <strong>{selectedNumbers.length}/6</strong></span>
            <div className="ticket-quick-actions">
              <button onClick={handleQuickPick} disabled={isDrawing || drawState !== 'OPEN'} className="quick-action-btn pick">✨ QUICK PICK</button>
              <button onClick={handleClear} disabled={isDrawing || drawState !== 'OPEN'} className="quick-action-btn clear">✕ CLEAR</button>
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
                  disabled={isDrawing || drawState !== 'OPEN'}
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
                {selectedGame.bets.map(tier => (
                  <button 
                    key={tier}
                    onClick={() => !isDrawing && setBetSize(tier)} 
                    disabled={isDrawing || drawState !== 'OPEN'} 
                    className={`bet-toggle-btn ${betSize === tier ? 'active' : ''}`}
                  >
                    ${tier}
                  </button>
                ))}
              </div>
            </div>

            <button 
              className="lottery-draw-action-btn"
              onClick={buyTicket}
              disabled={isDrawing || drawState !== 'OPEN' || selectedNumbers.length !== 6}
            >
              {drawState !== 'OPEN' ? 'SALES LOCKED 🔒' : 'BUY TICKET 🚀'}
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
          </div>
        </div>
      </div>

      {/* User's active tickets shelf spanned horizontally across the bottom container */}
      <div className="lottery-active-tickets-shelf-bottom">
        <h4>MY ACTIVE TICKETS (DRAW #{activeDrawId})</h4>
        <div className="panel-divider"></div>
        {myTickets.length === 0 ? (
          <p className="no-tickets-tag">No tickets purchased for this draw session. Pick your numbers above to buy a ticket!</p>
        ) : (
          <div className="tickets-scroll-row">
            {myTickets.map(t => {
              const matchesCount = drawResults.length > 0 ? t.chosenNumbers.filter(n => drawResults.includes(n)).length : null;
              return (
                <div key={t.id} className={`ticket-row-card ${t.payout > 0 ? 'won' : ''}`}>
                  <div className="ticket-card-header">
                    <span className="card-logo">CYBER LOTTO</span>
                    <span className="card-tx-id">#{t.id}</span>
                  </div>
                  <div className="ticket-card-numbers">
                    {t.chosenNumbers.map(n => (
                      <span key={n} className={`ticket-card-num-badge ${drawResults.includes(n) ? 'matched' : ''}`}>{n}</span>
                    ))}
                  </div>
                  <div className="ticket-card-meta">
                    <span>Bet: ${t.betAmount}</span>
                    {matchesCount !== null ? (
                      <span className="ticket-status-label font-gold">
                        Matched {matchesCount} (+${t.payout})
                      </span>
                    ) : (
                      <span className="ticket-status-label font-gray">PENDING DRAW ⏱️</span>
                    )}
                  </div>
                  <div className="ticket-barcode">
                    <div className="barcode-strip"></div>
                    <div className="barcode-numbers">49-CYBER-TICKET-{t.id}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default LotteryGame;
