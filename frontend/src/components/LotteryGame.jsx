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
  
  // Multi-ticket selection
  const [selectedTicketIds, setSelectedTicketIds] = useState([]);
  const [reservedTickets, setReservedTickets] = useState([]); // array of reserved tickets
  const [checkoutTimer, setCheckoutTimer] = useState(0);

  const [isDrawing, setIsDrawing] = useState(false);
  const [drawResults, setDrawResults] = useState([]); // official numbers
  const [revealedBalls, setRevealedBalls] = useState([]); // animated reveals
  const [winMessage, setWinMessage] = useState('');
  const [payoutAmount, setPayoutAmount] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const [ticketHistory, setTicketHistory] = useState([]);
  const [recentDraws, setRecentDraws] = useState([]);
  
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

  // Synchronize active selectedGame configuration when lobbyGames is reloaded (e.g. from back-office updates)
  useEffect(() => {
    if (selectedGame && lobbyGames.length > 0) {
      const updated = lobbyGames.find(g => g.id === selectedGame.id);
      if (updated) {
        if (updated.draw_interval_ms !== selectedGame.draw_interval_ms || 
            updated.ticket_price !== selectedGame.ticket_price || 
            updated.name !== selectedGame.name ||
            updated.status !== selectedGame.status) {
          setSelectedGame(updated);
        }
      }
    }
  }, [lobbyGames, selectedGame]);

  // Fetch status and ticket pool on selected game changes
  useEffect(() => {
    if (selectedGame) {
      handleClear();
      fetchStatus(selectedGame.name);
      fetchPoolTickets(selectedGame.name);
      fetchWinners(selectedGame.name);
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
            if (reservedTickets.length > 0) {
              setReservedTickets([]);
              setCheckoutTimer(0);
              alert("Drawing in progress! Active checkout ticket reservations have expired.");
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
          setReservedTickets([]);
          setCheckoutTimer(0);
          setSelectedTicketIds([]);

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
          setCountdown(activeGame.draw_interval_ms / 1000); // Reset local timer dynamically

          // Re-fetch status
          await fetchStatus(activeGame.name);
          fetchWinners(activeGame.name);
          
          // CRITICAL REQUIREMENT: Clear the ticket selection cards after a draw, forcing player to refresh options
          setPoolTickets([]);
          
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

          // Show resolved wagers for exactly 5 seconds, then auto-clear them
          setTimeout(() => {
            setMyTickets([]);
            setWinMessage('');
            setPayoutAmount(0);
            console.log('[WS] Wagers and outcome banners auto-cleared 5 seconds post-draw.');
          }, 5000);
        }
      } 
      // 2. Event belongs to background game - trigger top Toast Notification
      else if (currentUserRef.current) {
        if (event.type === 'DRAW_COMPLETED') {
          // Check if user had tickets in that background draw
          try {
            const checkRes = await fetch(`${API_BASE}/api/lottery/status?lotteryName=${encodeURIComponent(event.lotteryName)}&email=${currentUserRef.current.email}`);
            const checkData = await checkRes.json();
            if (checkData.success && checkData.tickets && checkData.tickets.length > 0) {
              let backgroundWinnings = 0;
              checkData.tickets.forEach(t => {
                if (t.claimed === 1 && t.payout > 0) {
                  backgroundWinnings += t.payout;
                }
              });
              if (backgroundWinnings > 0) {
                addToast(`🏆 Background Draw Completed: You won $${backgroundWinnings} on "${event.lotteryName}"!`);
              }
            }
          } catch (err) {
            console.error(err);
          }
        }
      }
    });

    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, []); // Empty dependency array to connect only once!

  // Visual countdown ticker timer
  useEffect(() => {
    if (!selectedGame) return;
    setCountdown(selectedGame.draw_interval_ms / 1000);

    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) return selectedGame.draw_interval_ms / 1000;
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [selectedGame]);

  // 30-Second Reservation Timer
  useEffect(() => {
    let interval = null;
    if (reservedTickets.length > 0 && checkoutTimer > 0) {
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
  }, [reservedTickets, checkoutTimer]);

  const handleReservationTimeout = async () => {
    if (reservedTickets.length === 0) return;
    const ticketIds = reservedTickets.map(t => t.id);
    setReservedTickets([]);
    setCheckoutTimer(0);
    setSelectedTicketIds([]);
    alert("30-Second Checkout reservation has expired! Reserved tickets have been returned to the pool.");
    
    try {
      await fetch(`${API_BASE}/api/lottery/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: currentUser.email, ticketIds })
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
        setSelectedTicketIds([]);
      }
    } catch (err) {
      console.error('Failed to fetch pool tickets:', err);
    } finally {
      setLoadingPool(false);
    }
  };

  const fetchWinners = async (gameName) => {
    try {
      const res = await fetch(`${API_BASE}/api/lottery/winners/${encodeURIComponent(gameName)}`);
      const data = await res.json();
      if (data.success && data.draws) {
        setRecentDraws(data.draws);
      }
    } catch (err) {
      console.error('Error fetching winners:', err);
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

  const toggleSelectTicket = (id) => {
    setSelectedTicketIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const triggerReserve = async (clickedId) => {
    if (!currentUser) {
      alert("Please log in to purchase tickets.");
      return;
    }
    if (isDrawing || drawState !== 'OPEN') return;

    // Collect checkout targets
    let targets = [...selectedTicketIds];
    if (clickedId && !targets.includes(clickedId)) {
      targets.push(clickedId);
    }

    if (targets.length === 0) {
      alert("Please check/select at least one ticket to checkout.");
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/lottery/reserve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: currentUser.email, ticketIds: targets })
      });
      const data = await response.json();

      if (data.success) {
        const matches = poolTickets.filter(t => targets.includes(t.id));
        setReservedTickets(matches);
        setCheckoutTimer(30);
      } else {
        alert(data.error || 'Failed to reserve selected tickets.');
        fetchPoolTickets(selectedGame.name);
      }
    } catch (err) {
      console.error('Reservation error:', err);
      alert('Could not connect to Reservation API.');
    }
  };

  const handleCancelCheckout = async () => {
    if (reservedTickets.length === 0) return;
    const ticketIds = reservedTickets.map(t => t.id);
    setReservedTickets([]);
    setCheckoutTimer(0);
    setSelectedTicketIds([]);

    try {
      await fetch(`${API_BASE}/api/lottery/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: currentUser.email, ticketIds })
      });
    } catch (err) {
      console.error('Release error:', err);
    }

    if (selectedGame) {
      fetchPoolTickets(selectedGame.name);
    }
  };

  const handleCheckout = async () => {
    if (reservedTickets.length === 0 || !currentUser || !selectedGame) return;

    const totalPrice = selectedGame.ticket_price * reservedTickets.length;
    if (currentUser.balance < totalPrice) {
      alert("Insufficient funds! Deposit cash inside your Wallet first.");
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/lottery/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: currentUser.email, ticketIds: reservedTickets.map(t => t.id) })
      });
      const data = await response.json();

      if (data.success) {
        alert(`Successfully purchased ${reservedTickets.length} ticket(s) for ${selectedGame.name}!`);
        setReservedTickets([]);
        setCheckoutTimer(0);
        setSelectedTicketIds([]);
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
            <p>Ready pool-ticket allocations secured with SHA-256 integrity checks. Select multiple tickets and execute secure batch reservations.</p>
            <div className="hero-badges">
              <span className="hero-badge-item">🛡️ Provably Fair</span>
              <span className="hero-badge-item">⚡ Multi-Select</span>
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

  const formatCountdown = (secs) => {
    if (isNaN(secs) || secs < 0) return '00:00:00';
    const h = Math.floor(secs / 3600).toString().padStart(2, '0');
    const m = Math.floor((secs % 3600) / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

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
        <div className="left-nav-meta">
          <div className="nav-item">Session: <strong className="highlight-draw-id">#{activeDrawId || '...'}</strong></div>
          <div className="nav-item">Game: <strong className="highlight-game-name">{selectedGame.name}</strong></div>
          <div className="nav-item">
            Status: <span className={`nav-status-badge status-${drawState.toLowerCase()}`}>{drawState}</span>
          </div>
        </div>
        <div className="right-countdown">
          <div className={`countdown-square ${countdown <= 10 && !isDrawing ? 'low-time-pulse' : ''}`}>
            {isDrawing ? '⏳' : formatCountdown(countdown)}
          </div>
          <span className="countdown-label">Next draw</span>
        </div>
      </div>

      <div className="lottery-main-layout">
        
        {/* Left Side: BROWSING PHASE / CHECKOUT PHASE */}
        <div className="lottery-ticket-box" style={{ position: 'relative' }}>
          
          {/* Reservation Lock Overlay (CHECKOUT PHASE) */}
          {reservedTickets.length > 0 && (
            <div className="checkout-lock-overlay">
              <div className="checkout-box" style={{ maxWidth: '420px' }}>
                <div className="checkout-header">
                  <span className="lock-tag">🔒 SECURE 30s RESERVATION LOCK</span>
                  <h3>COMPLETE BATCH CHECKOUT</h3>
                  <div className="countdown-ring">
                    EXPIRES IN: <span className="timer-sec">{checkoutTimer}s</span>
                  </div>
                </div>
                
                <div className="checkout-ticket-details" style={{ maxHeight: '160px', overflowY: 'auto' }}>
                  {reservedTickets.map(ticket => (
                    <div key={ticket.id} className="ticket-detail-row" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '6px', marginBottom: '6px' }}>
                      <span>Ticket #{ticket.id}:</span>
                      <div className="checkout-nums">
                        {ticket.chosenNumbers.map(n => (
                          <span key={n} className="checkout-num-badge" style={{ width: '20px', height: '20px', fontSize: '0.65rem' }}>{n}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                  <div className="ticket-detail-row" style={{ marginTop: '10px' }}>
                    <span>TOTAL PRICE ({reservedTickets.length} wagers):</span>
                    <strong style={{ color: 'var(--forest-gold)', fontSize: '1.15rem' }}>${selectedGame.ticket_price * reservedTickets.length}</strong>
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
            <div className="security-tag">Select one or more tickets to batch reserve and purchase wagers.</div>
          </div>

          <div className="ticket-helper-bar">
            <span>Available tickets: <strong>{poolTickets.length}</strong></span>
            <div className="ticket-quick-actions">
              <button 
                onClick={() => fetchPoolTickets(selectedGame.name)} 
                disabled={isDrawing || drawState !== 'OPEN' || reservedTickets.length > 0} 
                className="quick-action-btn pick"
              >
                🔄 REFRESH OPTIONS
              </button>
            </div>
          </div>

          {/* Available tickets list */}
          {loadingPool ? (
            <div className="loader-placeholder">Loading available ticket pool...</div>
          ) : poolTickets.length === 0 ? (
            <div className="loader-placeholder" style={{ padding: '60px 10px', textAlign: 'center' }}>
              <p style={{ color: '#ff0055', marginBottom: '15px' }}>⚠️ tickets cleared following draw completion</p>
              <button 
                onClick={() => fetchPoolTickets(selectedGame.name)}
                className="quick-action-btn pick"
                style={{ margin: '0 auto', display: 'block', padding: '10px 24px' }}
              >
                🎰 SPIN NEW TICKETS
              </button>
            </div>
          ) : (
            <>
              <div className="pool-tickets-selection-grid compact-grid-cards">
                {poolTickets.map((t) => {
                  const isChecked = selectedTicketIds.includes(t.id);
                  return (
                    <div key={t.id} className={`pool-ticket-option-card compact-card ${isChecked ? 'active-checked' : ''}`}>
                      <div className="compact-card-left">
                        <label className="checkbox-select-flag">
                          <input 
                            type="checkbox" 
                            checked={isChecked}
                            onChange={() => toggleSelectTicket(t.id)}
                            disabled={isDrawing || drawState !== 'OPEN' || reservedTickets.length > 0}
                          />
                          <span className="checkbox-custom-display"></span>
                        </label>
                        <span className="compact-card-id">#{t.id}</span>
                      </div>

                      <div className="compact-card-center-numbers">
                        {t.chosenNumbers.map(n => (
                          <span key={n} className="option-num-badge small-badge">{n}</span>
                        ))}
                      </div>

                      <div className="compact-card-right-actions">
                        <span className="compact-card-price">${selectedGame.ticket_price}</span>
                        <button 
                          disabled={isDrawing || drawState !== 'OPEN' || reservedTickets.length > 0}
                          onClick={() => triggerReserve(t.id)}
                          className="pool-select-buy-btn tiny-buy-btn"
                          title="Instant Buy"
                        >
                          Buy
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Bottom Checkout Helper/Buy Bar */}
              <div className="ticket-checkout-bottom-bar">
                <div className="checkout-summary-left">
                  <label className="select-all-checkbox-label">
                    <input 
                      type="checkbox"
                      checked={poolTickets.length > 0 && selectedTicketIds.length === poolTickets.length}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedTicketIds(poolTickets.map(t => t.id));
                        } else {
                          setSelectedTicketIds([]);
                        }
                      }}
                      disabled={isDrawing || drawState !== 'OPEN' || reservedTickets.length > 0}
                    />
                    <span>Select All ({poolTickets.length})</span>
                  </label>
                  <div className="selection-count-info">
                    <span>Selected: <strong>{selectedTicketIds.length}</strong></span>
                    <span className="summary-price-label">Total Price: <strong>${selectedTicketIds.length * selectedGame.ticket_price}</strong></span>
                  </div>
                </div>
                <div className="checkout-action-right">
                  <button 
                    onClick={() => triggerReserve()}
                    disabled={selectedTicketIds.length === 0 || isDrawing || drawState !== 'OPEN' || reservedTickets.length > 0}
                    className="bulk-buy-btn"
                  >
                    🚀 BUY SELECTED TICKETS
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Results feedback banner */}
          {winMessage && (
            <div className={`lottery-result-banner ${payoutAmount > 0 ? 'win' : 'lose'}`} style={{ marginTop: '20px', marginBottom: '60px' }}>
              {winMessage}
            </div>
          )}
        </div>

        {/* Right Panel: Official Draw Balls & Active Wagers */}
        <div className="lottery-payout-panel">
          <div className="official-draw-balls-section">
            <h3 className="section-title">OFFICIAL DRAW BALLS</h3>
            <div className="draw-balls-row">
              {Array.from({ length: 6 }).map((_, index) => {
                const ballRevealed = revealedBalls.length > index;
                const value = ballRevealed ? revealedBalls[index] : '?';

                return (
                  <div 
                    key={index} 
                    className={`official-draw-ball ${ballRevealed ? 'revealed' : ''} ${isDrawing && revealedBalls.length === index ? 'pulsing-loader' : ''}`}
                  >
                    <span>{value}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="active-wagers-section">
            <h3 className="active-wagers-title">MY ACTIVE WAGERS (DRAW #{activeDrawId})</h3>
            
            {myTickets.length === 0 ? (
              <p className="no-wagers-msg" style={{ fontSize: '0.75rem', color: '#888', textAlign: 'center', padding: '15px 0' }}>No active wagers for this draw.</p>
            ) : (
              <>
                <div className="wagers-list-scrollable">
                  {myTickets.map(t => {
                    const isResolved = t.claimed === 1;
                    const matchesCount = drawResults.length > 0 ? t.chosenNumbers.filter(n => drawResults.includes(n)).length : null;
                    
                    return (
                      <div key={t.id} className="wager-card">
                        <div className="wager-card-header" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: '8px' }}>
                          {isResolved ? (
                            t.payout > 0 ? (
                              <span className="wager-status-badge win">
                                🏆 Win (+${t.payout})
                              </span>
                            ) : (
                              <span className="wager-status-badge loss">
                                Loss
                              </span>
                            )
                          ) : matchesCount !== null ? (
                            <span className="wager-status-badge matched">
                              Matched {matchesCount} (+${t.payout})
                            </span>
                          ) : (
                            <span className="wager-status-badge pending">
                              ⏳ Pending
                            </span>
                          )}
                        </div>
                        <div className="wager-numbers-row">
                          {t.chosenNumbers.map(n => {
                            const matched = drawResults.includes(n);
                            return (
                              <span key={n} className={`wager-num-badge ${matched ? 'matched' : ''}`}>
                                {n}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {myTickets.length > 2 && (
                  <div className="scroll-indicator">
                    ↓ {myTickets.length - 2} more tickets — scroll to view
                  </div>
                )}
              </>
            )}
          </div>

          {/* Previous Winners Section */}
          <div className="previous-winners-section" style={{ marginTop: '30px' }}>
            <h3 className="previous-winners-title" style={{ fontFamily: 'Orbitron, sans-serif', fontSize: '0.85rem', color: '#ffcc00', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: '10px' }}>Previous Winners</h3>
            <div className="panel-divider" style={{ margin: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.08)' }}></div>
            {recentDraws.length === 0 ? (
              <p className="no-wagers-msg" style={{ fontSize: '0.75rem', color: '#888', textAlign: 'center', padding: '15px 0' }}>No completed draws yet.</p>
            ) : (
              <div className="previous-winners-scrollable" style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '250px', overflowY: 'auto' }}>
                {recentDraws.map(draw => (
                  <div key={draw.drawId} className="winner-row-card" style={{ background: 'rgba(0, 0, 0, 0.25)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '8px', padding: '12px' }}>
                    <div className="winner-card-header" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '8px' }}>
                      <span style={{ color: '#00ffcc', fontWeight: 'bold' }}>DRAW #{draw.drawId}</span>
                      <span style={{ color: '#888' }}>{new Date(draw.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    </div>
                    <div className="winner-balls-row" style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
                      {draw.winningNumbers && draw.winningNumbers.map(n => (
                        <span key={n} className="winner-num-badge" style={{ width: '22px', height: '22px', borderRadius: '50%', border: '1px solid #00ffcc', color: '#00ffcc', display: 'flex', justifyContent: 'center', alignContent: 'center', alignItems: 'center', fontSize: '0.7rem', fontWeight: 'bold' }}>{n}</span>
                      ))}
                    </div>
                    <div className="winner-card-meta" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                      <span style={{ color: '#888' }}>Winners: <strong style={{ color: '#fff' }}>{draw.winnersCount}</strong></span>
                      <span style={{ color: '#888' }}>Payout: <strong style={{ color: 'var(--neon-green)' }}>${draw.totalPaidOut}</strong></span>
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

export default LotteryGame;
