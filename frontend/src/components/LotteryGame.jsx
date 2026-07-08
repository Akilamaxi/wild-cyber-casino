import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';

const API_BASE = '';

function LotteryGame({ currentUser, onBalanceUpdate }) {
  // Navigation State: null = Games Lobby, otherwise active game object
  const [selectedGame, setSelectedGame] = useState(null);
  const [lobbyGames, setLobbyGames] = useState([]);
  
  // Selection and Reservation States
  const [poolTickets, setPoolTickets] = useState([]);
  const [loadingPool, setLoadingPool] = useState(false);
  const [reservedTicket, setReservedTicket] = useState(null);
  const [checkoutTimer, setCheckoutTimer] = useState(0);

  const [isDrawing, setIsDrawing] = useState(false);
  const [drawResults, setDrawResults] = useState([]); // official numbers
  const [revealedBalls, setRevealedBalls] = useState([]); // animated reveals
  const [winMessage, setWinMessage] = useState('');
  const [payoutAmount, setPayoutAmount] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const [ticketHistory, setTicketHistory] = useState([]);
  
  // History View Controls
  const [historyPage, setHistoryPage] = useState(1);
  const [historyFilter, setHistoryFilter] = useState('ALL');
  const [historySearch, setHistorySearch] = useState('');
  
  // Real-Time States
  const [activeDrawId, setActiveDrawId] = useState(null);
  const [drawState, setDrawState] = useState('OPEN'); // OPEN, LOCKED, DRAWING, COMPLETED
  const [myTickets, setMyTickets] = useState([]);
  const [countdown, setCountdown] = useState(30);
 
  // Background Toasts Alerts
  const [toasts, setToasts] = useState([]);
  const socketRef = useRef(null);
  const myTicketsRef = useRef([]);
  const currentUserRef = useRef(null);
  const selectedGameRef = useRef(null);
  const lobbyGamesRef = useRef([]);

  // Keep refs up-to-date
  useEffect(() => {
    myTicketsRef.current = myTickets;
  }, [myTickets]);

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  useEffect(() => {
    selectedGameRef.current = selectedGame;
  }, [selectedGame]);

  useEffect(() => {
    lobbyGamesRef.current = lobbyGames;
  }, [lobbyGames]);

  const fetchGames = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/lottery/games`);
      const data = await response.json();
      if (data.success) {
        setLobbyGames(data.games);
      }
    } catch (err) {
      console.error('Failed to fetch active games:', err);
    }
  };

  // Fetch active games configurations from the database on mount
  useEffect(() => {
    fetchGames();
  }, []);

  // Fetch status and ticket pool on selected game changes
  useEffect(() => {
    if (selectedGame) {
      handleClear();
      fetchStatus(selectedGame.name);
      fetchPoolTickets(selectedGame.name);
    }
  }, [selectedGame]);

  // Connect WebSockets EXACTLY ONCE on mount
  useEffect(() => {
    socketRef.current = io(API_BASE);

    socketRef.current.on('connect', () => {
      console.log('[WS] Connected to lottery websocket engine.');
      socketRef.current.emit('request_initial_state');
    });

    socketRef.current.on('lottery_events', async (event) => {
      console.log('[WS] Multi-game Event received:', event);

      if (event.type === 'GAME_CONFIG_UPDATED') {
        console.log('[WS] Hot-reloading games configuration list...');
        fetchGames();
        return;
      }

      const activeGame = selectedGameRef.current;

      // 1. Event belongs to the active selected game
      if (activeGame && event.lotteryName === activeGame.name) {
        if (event.type === 'DRAW_STATE_CHANGED') {
          setDrawState(event.state);
          if (event.state === 'LOCKED' || event.state === 'DRAWING') {
            setIsDrawing(true);
            // Forcefully clear reservation if sales lock for drawing
            if (reservedTicket) {
              setReservedTicket(null);
              setCheckoutTimer(0);
              alert("Drawing in progress! Active checkout ticket reservation has expired.");
            }
          } else if (event.state === 'OPEN') {
            setIsDrawing(false);
            setDrawState('OPEN');
            fetchPoolTickets(activeGame.name);
          }
        } else if (event.type === 'DRAW_COMPLETED') {
          setDrawState('COMPLETED');
          setIsDrawing(true);
          setDrawResults(event.winningNumbers);
          
          // Clear checkout if drawing complete
          setReservedTicket(null);
          setCheckoutTimer(0);

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

          // Re-fetch status and reload pool
          fetchStatus(activeGame.name);
          fetchPoolTickets(activeGame.name);
          
          // Calculate matches and display banner
          if (currentUserRef.current) {
            let totalWonThisDraw = 0;
            let bestMatchCount = 0;

            myTicketsRef.current.forEach(t => {
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
              setWinMessage(`🎉 YOU WON $${totalWonThisDraw} on ${activeGame.name} (Max Match: ${bestMatchCount} numbers)! 🎉`);
            } else {
              setWinMessage(`NO WIN on ${activeGame.name} (Max Match: ${bestMatchCount} numbers). Try another ticket!`);
            }
          }
        }
      } 
      // 2. Event belongs to background game - trigger top Toast Notification
      else if (event.type === 'DRAW_COMPLETED') {
        const matchingGame = lobbyGamesRef.current.find(g => g.name === event.lotteryName);
        const nameLabel = matchingGame ? matchingGame.name : event.lotteryName;
        addToast(`📢 DRAW COMPLETED: ${nameLabel} winning balls: [${event.winningNumbers.join(', ')}]!`);
      }
    });

    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, []); // Empty dependency array to connect only once!

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

  // 30-Second Reservation Timer
  useEffect(() => {
    let interval = null;
    if (reservedTicket && checkoutTimer > 0) {
      interval = setInterval(() => {
        setCheckoutTimer(prev => {
          if (prev <= 1) {
            handleReservationTimeout();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [reservedTicket, checkoutTimer]);

  const handleReservationTimeout = async () => {
    if (!reservedTicket) return;
    const ticketId = reservedTicket.id;
    setReservedTicket(null);
    setCheckoutTimer(0);
    alert("30-Second Checkout reservation has expired! The ticket is thrown back into the pool.");
    
    try {
      await fetch(`${API_BASE}/api/lottery/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: currentUser.email, ticketId })
      });
    } catch (err) {
      console.error(err);
    }

    if (selectedGame) {
      fetchPoolTickets(selectedGame.name);
    }
  };

  const addToast = (msg) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, text: msg }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 6000); // disappear after 6 seconds
  };

  const fetchStatus = async (gameName) => {
    try {
      const activeUser = currentUserRef.current;
      const emailParam = activeUser ? `&email=${activeUser.email}` : '';
      const response = await fetch(`${API_BASE}/api/lottery/status?lotteryName=${encodeURIComponent(gameName)}${emailParam}`);
      const data = await response.json();
      if (data.success) {
        const activeGame = selectedGameRef.current;
        if (activeGame && gameName === activeGame.name) {
          setActiveDrawId(data.draw.id);
          setDrawState(data.draw.state);
          setMyTickets(data.tickets || []);
        }
        
        // Sync user balance with DB
        if (activeUser) {
          const walletRes = await fetch(`${API_BASE}/api/user/wallet?email=${activeUser.email}`);
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

  const fetchPoolTickets = async (gameName) => {
    setLoadingPool(true);
    try {
      const response = await fetch(`${API_BASE}/api/lottery/pool-tickets?lotteryName=${encodeURIComponent(gameName)}`);
      const data = await response.json();
      if (data.success) {
        setPoolTickets(data.tickets);
      }
    } catch (err) {
      console.error('Failed to fetch pool tickets:', err);
    } finally {
      setLoadingPool(false);
    }
  };

  const fetchHistory = async () => {
    if (!currentUser) return;
    try {
      const response = await fetch(`${API_BASE}/api/lottery/history?email=${currentUser.email}`);
      const data = await response.json();
      if (data.success) {
        setTicketHistory(data.tickets);
        setHistoryPage(1);
        setHistoryFilter('ALL');
        setHistorySearch('');
        setShowHistory(true);
      }
    } catch (err) {
      console.error('Failed to fetch ticket history:', err);
    }
  };

  const handleClear = () => {
    setDrawResults([]);
    setRevealedBalls([]);
    setWinMessage('');
    setPayoutAmount(0);
  };

  const handleReserve = async (ticket) => {
    if (!currentUser) {
      alert("Please log in to purchase tickets.");
      return;
    }
    if (isDrawing || drawState !== 'OPEN') return;

    try {
      const response = await fetch(`${API_BASE}/api/lottery/reserve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: currentUser.email, ticketId: ticket.id })
      });
      const data = await response.json();

      if (data.success) {
        setReservedTicket(ticket);
        setCheckoutTimer(30);
      } else {
        alert(data.error || 'Failed to reserve ticket.');
        fetchPoolTickets(selectedGame.name);
      }
    } catch (err) {
      console.error('Reservation error:', err);
      alert('Could not connect to Reservation API.');
    }
  };

  const handleCancelCheckout = async () => {
    if (!reservedTicket) return;
    const ticketId = reservedTicket.id;
    setReservedTicket(null);
    setCheckoutTimer(0);

    try {
      await fetch(`${API_BASE}/api/lottery/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: currentUser.email, ticketId })
      });
    } catch (err) {
      console.error('Release error:', err);
    }

    if (selectedGame) {
      fetchPoolTickets(selectedGame.name);
    }
  };

  const handleCheckout = async () => {
    if (!reservedTicket || !currentUser || !selectedGame) return;

    if (currentUser.balance < selectedGame.ticket_price) {
      alert("Insufficient funds! Deposit cash inside your Wallet first.");
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/lottery/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: currentUser.email, ticketId: reservedTicket.id })
      });
      const data = await response.json();

      if (data.success) {
        alert(`Ticket #${reservedTicket.id} successfully purchased for ${selectedGame.name}!`);
        setReservedTicket(null);
        setCheckoutTimer(0);
        fetchStatus(selectedGame.name);
        fetchPoolTickets(selectedGame.name);
      } else {
        alert(data.error || 'Checkout process rejected.');
      }
    } catch (err) {
      console.error('Checkout error:', err);
      alert('Could not connect to Checkout API.');
    }
  };

  // ============================================================================
  // RENDER VIEW A: TICKET HISTORY
  // ============================================================================
  if (showHistory) {
    const filteredHistory = ticketHistory.filter(t => {
      // Search Text
      const searchStr = historySearch.toLowerCase();
      const matchSearch = t.lotteryName.toLowerCase().includes(searchStr) || 
                          t.id.toString().includes(searchStr) ||
                          t.drawId.toString().includes(searchStr);
      if (!matchSearch) return false;

      // Status Filter
      const isDrawComplete = t.drawState === 'COMPLETED';
      const isWin = t.payout > 0;
      if (historyFilter === 'WON') return isDrawComplete && isWin;
      if (historyFilter === 'LOSS') return isDrawComplete && !isWin;
      if (historyFilter === 'PENDING') return !isDrawComplete;
      return true;
    });

    const PAGE_SIZE = 24;
    const totalPages = Math.ceil(filteredHistory.length / PAGE_SIZE) || 1;
    const currentList = filteredHistory.slice((historyPage - 1) * PAGE_SIZE, historyPage * PAGE_SIZE);

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
        <div className="lottery-active-tickets-shelf-bottom" style={{ marginTop: '0', display: 'flex', flexDirection: 'column', height: '100%' }}>
          
          <div className="history-header-controls">
            <h4>MY TICKET HISTORY</h4>
            <div className="history-filters">
              <input 
                type="text" 
                className="history-search-input" 
                placeholder="Search ticket or game..." 
                value={historySearch} 
                onChange={(e) => { setHistorySearch(e.target.value); setHistoryPage(1); }} 
              />
              <select 
                className="history-filter-select" 
                value={historyFilter} 
                onChange={(e) => { setHistoryFilter(e.target.value); setHistoryPage(1); }}
              >
                <option value="ALL">All Tickets</option>
                <option value="WON">Won Only</option>
                <option value="LOSS">Loss Only</option>
                <option value="PENDING">Pending Only</option>
              </select>
            </div>
          </div>
          
          <div className="panel-divider"></div>

          {currentList.length === 0 ? (
             <p className="no-tickets-tag">No tickets found matching your criteria.</p>
          ) : (
             <>
               <div className="tickets-grid history-grid-small">
                  {currentList.map(t => {
                    const isDrawComplete = t.drawState === 'COMPLETED';
                    const isWin = t.payout > 0;
                    
                    return (
                      <div key={t.id} className={`ticket-row-card small-card ${isWin ? 'won' : ''}`}>
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
                          <span style={{ fontSize: '0.65rem', color: '#888' }}>{new Date(t.timestamp).toLocaleString()}</span>
                          {isDrawComplete ? (
                            isWin ? (
                              <span className="ticket-status-label font-gold">WIN (+${t.payout})</span>
                            ) : (
                              <span className="ticket-status-badge loss">LOSS</span>
                            )
                          ) : (
                            <span className="ticket-status-label font-gray">PENDING ⏱️</span>
                          )}
                        </div>
                        <div className="ticket-barcode">
                          <div className="barcode-strip"></div>
                          <div className="barcode-numbers">49-CYBER-{t.id}</div>
                        </div>
                      </div>
                    );
                  })}
               </div>
               
               <div className="history-pagination">
                 <button 
                   disabled={historyPage === 1} 
                   onClick={() => setHistoryPage(prev => prev - 1)}
                 >
                   PREV
                 </button>
                 <span>PAGE {historyPage} OF {totalPages}</span>
                 <button 
                   disabled={historyPage === totalPages} 
                   onClick={() => setHistoryPage(prev => prev + 1)}
                 >
                   NEXT
                 </button>
               </div>
             </>
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
            <p>Ready pool-ticket allocations secured with SHA-256 integrity checks. Reserve your lottery numbers instantly and execute secure ledger checkouts.</p>
            <div className="hero-badges">
              <span className="hero-badge-item">🛡️ Provably Fair</span>
              <span className="hero-badge-item">⚡ 30s Lockouts</span>
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
          <p className="panel-subtitle">Choose a draw game configuration to browse ready tickets and reserve wagers.</p>
          <div className="section-divider"></div>
          {currentUser && (
            <button className="history-btn" onClick={() => fetchHistory()}>
              📜 MY TICKET HISTORY
            </button>
          )}
        </div>

        {/* Games Selector Grid */}
        <div className="lottery-lobby-grid">
          {lobbyGames.map(game => (
            <div 
              key={game.name} 
              className="lottery-lobby-card"
              onClick={() => setSelectedGame(game)}
            >
              <div className="lottery-badge-wrap">
                <span className="lottery-card-badge">⚡ ACTIVE</span>
              </div>
              <div className="lottery-card-main">
                <h3>{game.name}</h3>
                <p className="lottery-card-desc">Interval: {game.draw_interval_ms / 1000} seconds. Sustaining payout system.</p>
              </div>
              <div className="lottery-card-footer">
                <div className="info-stat">
                  <span className="info-label">TICKET VALUE</span>
                  <span className="info-value">${game.ticket_price}</span>
                </div>
                <div className="info-stat">
                  <span className="info-label">HOUSE EDGE</span>
                  <span className="info-value">{(game.house_edge_percentage * 100).toFixed(0)}%</span>
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
  // RENDER VIEW C: TICKET SELECTION & RESERVATION VIEW
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
        
        {/* Left Side: BROWSING PHASE / CHECKOUT PHASE */}
        <div className="lottery-ticket-box" style={{ position: 'relative' }}>
          
          {/* Reservation Lock Overlay (CHECKOUT PHASE) */}
          {reservedTicket && (
            <div className="checkout-lock-overlay">
              <div className="checkout-box">
                <div className="checkout-header">
                  <span className="lock-tag">🔒 SECURE 30s RESERVATION LOCK</span>
                  <h3>COMPLETE CHECKOUT</h3>
                  <div className="countdown-ring">
                    EXPIRES IN: <span className="timer-sec">{checkoutTimer}s</span>
                  </div>
                </div>
                
                <div className="checkout-ticket-details">
                  <div className="ticket-detail-row">
                    <span>TICKET ID:</span>
                    <strong>#{reservedTicket.id}</strong>
                  </div>
                  <div className="ticket-detail-row">
                    <span>NUMBERS:</span>
                    <div className="checkout-nums">
                      {reservedTicket.chosenNumbers.map(n => (
                        <span key={n} className="checkout-num-badge">{n}</span>
                      ))}
                    </div>
                  </div>
                  <div className="ticket-detail-row">
                    <span>TOTAL PRICE:</span>
                    <strong style={{ color: 'var(--forest-gold)', fontSize: '1.25rem' }}>${selectedGame.ticket_price}</strong>
                  </div>
                </div>

                <div className="checkout-actions">
                  <button 
                    onClick={handleCheckout}
                    className="checkout-complete-btn"
                  >
                    AUTHORIZE PAYMENT 💳
                  </button>
                  <button 
                    onClick={handleCancelCheckout}
                    className="checkout-cancel-btn"
                  >
                    CANCEL CHECKOUT
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Drawing Lock Overlay */}
          {(isDrawing || drawState !== 'OPEN') && (
            <div className="drawing-lock-overlay">
              <div className="lock-message-box">
                <span className="lock-icon">⚠️</span>
                <h3>DRAW IN PROGRESS</h3>
                <p>Ticket generation and selection are locked during drawings. Please wait for the next open session!</p>
                <div className="drawing-pulse-bar"></div>
              </div>
            </div>
          )}

          {/* Browsing Phase Selector Lobby */}
          <div className="ticket-header">
            <h2>{selectedGame.name.toUpperCase()} LOBBY</h2>
            <div className="security-tag">Select a pre-generated ticket to begin checkout.</div>
          </div>

          <div className="ticket-helper-bar">
            <span>Select one of the 5 pre-generated tickets:</span>
            <div className="ticket-quick-actions">
              <button 
                onClick={() => fetchPoolTickets(selectedGame.name)} 
                disabled={isDrawing || drawState !== 'OPEN' || reservedTicket} 
                className="quick-action-btn pick"
                style={{ background: 'var(--forest-gold)', color: '#000' }}
              >
                🔄 REFRESH OPTIONS
              </button>
            </div>
          </div>

          {/* Available tickets list */}
          {loadingPool ? (
            <div className="loader-placeholder">Loading available ticket pool...</div>
          ) : poolTickets.length === 0 ? (
            <div className="loader-placeholder" style={{ padding: '60px 10px', color: '#ff0055' }}>
              ⚠️ Generating tickets... Please click Refresh Options!
            </div>
          ) : (
            <div className="pool-tickets-selection-grid">
              {poolTickets.map((t) => (
                <div key={t.id} className="pool-ticket-option-card">
                  <div className="option-card-header">
                    <span>TICKET #{t.id}</span>
                    <span className="price-tag">${selectedGame.ticket_price}</span>
                  </div>
                  <div className="option-card-numbers">
                    {t.chosenNumbers.map(n => (
                      <span key={n} className="option-num-badge">{n}</span>
                    ))}
                  </div>
                  <button 
                    disabled={isDrawing || drawState !== 'OPEN' || reservedTicket}
                    onClick={() => handleReserve(t)}
                    className="pool-select-buy-btn"
                  >
                    SELECT & BUY 🎟️
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Results feedback banner */}
          {winMessage && (
            <div className={`lottery-result-banner ${payoutAmount > 0 ? 'win' : 'lose'}`} style={{ marginTop: '20px' }}>
              {winMessage}
            </div>
          )}
        </div>

        {/* Right Panel: Official Draw Balls */}
        <div className="lottery-payout-panel">
          <h3>OFFICIAL DRAW BALLS</h3>
          <div className="panel-divider"></div>

          <div className="lottery-draw-results-shelf" style={{ marginTop: '20px', background: 'transparent', padding: 0 }}>
            <div className="draw-balls-row" style={{ justifyContent: 'center', gap: '10px' }}>
              {Array.from({ length: 6 }).map((_, index) => {
                const ballRevealed = revealedBalls.length > index;
                const value = ballRevealed ? revealedBalls[index] : '?';

                return (
                  <div 
                    key={index} 
                    className={`draw-ball ${ballRevealed ? 'revealed bounce-enter' : 'hidden-ball'} ${isDrawing && revealedBalls.length === index ? 'pulsing-loader' : ''}`}
                    style={{ width: '42px', height: '42px', fontSize: '1rem' }}
                  >
                    <span>{value}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

      </div>

      {/* User's active tickets shelf */}
      <div className="lottery-active-tickets-shelf-bottom">
        <h4>MY ACTIVE WAGERS (DRAW #{activeDrawId})</h4>
        <div className="panel-divider"></div>
        {myTickets.length === 0 ? (
          <p className="no-tickets-tag">No active wagers registered for this draw session. Purchase a pool ticket above to participate!</p>
        ) : (
          <div className="tickets-scroll-row">
            {myTickets.map(t => {
              const isResolved = t.claimed === 1;
              const matchesCount = drawResults.length > 0 ? t.chosenNumbers.filter(n => drawResults.includes(n)).length : null;
              
              return (
                <div key={t.id} className={`ticket-row-card ${isResolved && t.payout > 0 ? 'won' : ''} ${isResolved && t.payout === 0 ? 'loss-card' : ''}`}>
                  <div className="ticket-card-header">
                    <span className="card-logo">CYBER LOTTO</span>
                    <span className="card-tx-id">#{t.id}</span>
                  </div>
                  <div className="ticket-card-numbers">
                    {t.chosenNumbers.map(n => {
                      const matched = drawResults.includes(n);
                      return <span key={n} className={`ticket-card-num-badge ${matched ? 'matched' : ''}`}>{n}</span>;
                    })}
                  </div>
                  <div className="ticket-card-meta">
                    <span>Bet: ${t.betAmount}</span>
                    {isResolved ? (
                      t.payout > 0 ? (
                        <span className="ticket-status-label font-gold">
                          WIN (+${t.payout})
                        </span>
                      ) : (
                        <span className="ticket-status-badge loss">LOSS</span>
                      )
                    ) : matchesCount !== null ? (
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
