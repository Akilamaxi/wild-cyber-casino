import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';

const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:5000' : '';

function CyberDiceGame({ currentUser, onBalanceUpdate }) {
  const [activeMode, setActiveMode] = useState('single'); // 'single' | 'tournament'
  const [betSize, setBetSize] = useState(10);
  const [prediction, setPrediction] = useState('OVER_7'); // 'UNDER_7' | 'EXACT_7' | 'OVER_7' | 'DOUBLES'

  // Dice state
  const [dice, setDice] = useState([3, 4]); // [die1, die2]
  const [rolling, setRolling] = useState(false);
  const [rollResult, setRollResult] = useState(null);
  const [rollSummary, setRollSummary] = useState('');

  // Tournaments state
  const [tournaments, setTournaments] = useState([]);
  const [activeTourney, setActiveTourney] = useState(null);
  const [joined, setJoined] = useState(false);
  const [rollsLeft, setRollsLeft] = useState(10);
  const [tourneyScore, setTourneyScore] = useState(0);
  const [leaderboard, setLeaderboard] = useState([]);
  const [loadingTourney, setLoadingTourney] = useState(false);

  // Emojis for dice faces
  const DICE_FACES = {
    1: '⚀',
    2: '⚁',
    3: '⚂',
    4: '⚃',
    5: '⚄',
    6: '⚅'
  };

  useEffect(() => {
    if (activeMode === 'tournament') {
      fetchTournaments();
    }
  }, [activeMode]);

  useEffect(() => {
    if (activeTourney) {
      loadLeaderboard(activeTourney.id);
      checkUserRegistration(activeTourney.id);
    }
  }, [activeTourney]);

  // --- Fetchers ---
  const fetchTournaments = async () => {
    setLoadingTourney(true);
    try {
      const res = await fetch(`${API_BASE}/api/dice/tournaments`);
      const data = await res.json();
      if (data.success && data.tournaments.length > 0) {
        setTournaments(data.tournaments);
        setActiveTourney(data.tournaments[0]); // default to first active
      }
    } catch (err) {
      console.error(err);
    }
    setLoadingTourney(false);
  };

  const loadLeaderboard = async (tourneyId) => {
    try {
      const res = await fetch(`${API_BASE}/api/dice/tournament/leaderboard/${tourneyId}`);
      const data = await res.json();
      if (data.success) {
        setLeaderboard(data.leaderboard);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const checkUserRegistration = async (tourneyId) => {
    try {
      const res = await fetch(`${API_BASE}/api/dice/tournament/leaderboard/${tourneyId}`);
      const data = await res.json();
      if (data.success) {
        const found = data.leaderboard.find(p => p.email.toLowerCase() === currentUser.email.toLowerCase());
        if (found) {
          setJoined(true);
          setRollsLeft(found.rolls_left);
          setTourneyScore(found.total_score);
        } else {
          setJoined(false);
          setRollsLeft(10);
          setTourneyScore(0);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  // --- Actions ---
  const handleSingleRoll = async () => {
    if (rolling) return;
    if (currentUser.balance < betSize) {
      alert('Insufficient wallet balance for this bet!');
      return;
    }

    setRolling(true);
    setRollResult(null);
    setRollSummary('');

    // Optimistically deduct bet cost
    onBalanceUpdate(currentUser.balance - betSize);

    // Bouncing dice animation
    let cycles = 0;
    const interval = setInterval(() => {
      setDice([Math.floor(Math.random() * 6) + 1, Math.floor(Math.random() * 6) + 1]);
      cycles++;
      if (cycles > 15) {
        clearInterval(interval);
        triggerRollRequest();
      }
    }, 80);
  };

  const triggerRollRequest = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/dice/roll-single`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: currentUser.email, bet: betSize, prediction })
      });
      const data = await res.json();

      if (data.success) {
        setDice([data.die1, data.die2]);
        setRollResult(data);
        onBalanceUpdate(data.newBalance);
        setRollSummary(data.win ? `🎉 WON +$${data.payout.toFixed(2)}!` : '💥 LOST! TRY AGAIN');
      } else {
        alert(data.error);
        onBalanceUpdate(currentUser.balance); // Revert
      }
    } catch (err) {
      alert('Dice connection failure');
      onBalanceUpdate(currentUser.balance); // Revert
    }
    setRolling(false);
  };

  const handleJoinTournament = async () => {
    if (!activeTourney) return;
    if (currentUser.balance < activeTourney.entry_fee) {
      alert('Insufficient funds for entry fee!');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/dice/tournament/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: currentUser.email, tournamentId: activeTourney.id })
      });
      const data = await res.json();

      if (data.success) {
        setJoined(true);
        onBalanceUpdate(data.newBalance);
        loadLeaderboard(activeTourney.id);
        alert('Successfully joined the dice tournament!');
      } else {
        alert(data.error);
      }
    } catch (err) {
      alert('Could not join tournament.');
    }
  };

  const handleTournamentRoll = async () => {
    if (rolling || !activeTourney || rollsLeft <= 0) return;

    setRolling(true);
    setRollResult(null);
    setRollSummary('');

    // Shaking dice simulation
    let cycles = 0;
    const interval = setInterval(() => {
      setDice([Math.floor(Math.random() * 6) + 1, Math.floor(Math.random() * 6) + 1]);
      cycles++;
      if (cycles > 15) {
        clearInterval(interval);
        triggerTournamentRollRequest();
      }
    }, 80);
  };

  const triggerTournamentRollRequest = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/dice/tournament/roll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: currentUser.email, tournamentId: activeTourney.id })
      });
      const data = await res.json();

      if (data.success) {
        setDice([data.die1, data.die2]);
        setRollsLeft(data.rollsLeft);
        setTourneyScore(data.totalScore);
        loadLeaderboard(activeTourney.id);
        setRollResult({ sum: data.sum });
        setRollSummary(`🎲 Rolled sum ${data.sum}! Total score is now ${data.totalScore}`);
      } else {
        alert(data.error);
      }
    } catch (err) {
      alert('Tournament roll failed.');
    }
    setRolling(false);
  };

  return (
    <div className="dice-page-container">
      {/* Game Mode Navigation Header */}
      <div className="dice-navigation-banner">
        <div className="dice-mode-selectors">
          <button 
            className={`mode-tab-btn ${activeMode === 'single' ? 'active' : ''}`}
            onClick={() => { if (!rolling) setActiveMode('single'); }}
          >
            🎲 SINGLE PLAYER PLAY
          </button>
          <button 
            className={`mode-tab-btn ${activeMode === 'tournament' ? 'active' : ''}`}
            onClick={() => { if (!rolling) setActiveMode('tournament'); }}
          >
            🏆 DICE TOURNEY ARENA
          </button>
        </div>
        <div className="dice-status-panel">
          <span className="balance-tag">WALLET: ${currentUser.balance.toFixed(2)}</span>
        </div>
      </div>

      {/* Main layout */}
      <div className="dice-main-layout">
        
        {/* LEFT CARD: THE DICE FELT TRAY */}
        <div className="dice-felt-wrapper">
          <div className="dice-felt-tray">
            <div className="felt-tray-header">
              <h2>{activeMode === 'single' ? 'CYBER DICE FELT' : activeTourney?.name}</h2>
              <p className="felt-subtitle">PROVABLY FAIR CYBERPUNK CASINO ENGINE</p>
            </div>

            {/* Rolling area */}
            <div className="dice-rolling-table">
              <div className={`die-box ${rolling ? 'shaking-blur' : ''}`}>
                <span className="die-icon">{DICE_FACES[dice[0]]}</span>
              </div>
              <div className={`die-box ${rolling ? 'shaking-blur' : ''}`}>
                <span className="die-icon">{DICE_FACES[dice[1]]}</span>
              </div>
            </div>

            {/* Result text */}
            {rollSummary && (
              <div className={`dice-result-alert ${rollResult?.win ? 'win' : ''}`}>
                {rollSummary}
              </div>
            )}

            {/* Bottom Actions based on active mode */}
            {activeMode === 'single' ? (
              <div className="dice-felt-controls">
                <div className="bet-select-group">
                  <label>BET SIZE</label>
                  <div className="bet-buttons">
                    {[5, 10, 25, 50].map((size) => (
                      <button 
                        key={size}
                        disabled={rolling}
                        className={`bet-btn ${betSize === size ? 'active' : ''}`}
                        onClick={() => setBetSize(size)}
                      >
                        ${size}
                      </button>
                    ))}
                  </div>
                </div>

                <button 
                  className="dice-roll-main-btn"
                  onClick={handleSingleRoll}
                  disabled={rolling}
                >
                  {rolling ? 'ROLLING...' : '🎲 SHAKE & ROLL'}
                </button>
              </div>
            ) : (
              <div className="dice-felt-controls">
                {!joined ? (
                  <button 
                    className="dice-roll-main-btn tourney-join-btn"
                    onClick={handleJoinTournament}
                  >
                    🔑 JOIN CLASH (ENTRY FEE: ${activeTourney?.entry_fee} CASH)
                  </button>
                ) : (
                  <div className="joined-actions-row">
                    <div className="tourney-stats-bar">
                      <div>Score: <strong style={{ color: '#00ffcc' }}>{tourneyScore}</strong></div>
                      <div>Rolls Left: <strong style={{ color: '#ffcc00' }}>{rollsLeft} / 10</strong></div>
                    </div>
                    <button 
                      className="dice-roll-main-btn"
                      onClick={handleTournamentRoll}
                      disabled={rolling || rollsLeft <= 0}
                    >
                      {rollsLeft > 0 ? (rolling ? 'ROLLING...' : '🎲 ROLL TOURNAMENT') : '🏁 TOURNEY COMPLETE'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT CARD: MODE DETAILS & INFO */}
        <div className="dice-sidebar-panel">
          {activeMode === 'single' ? (
            <div className="single-details-card">
              <h3>SINGLE PLAYER PREDICTIONS</h3>
              <div className="panel-divider"></div>

              <div className="prediction-options">
                <button 
                  disabled={rolling}
                  className={`pred-option-btn ${prediction === 'UNDER_7' ? 'active' : ''}`}
                  onClick={() => setPrediction('UNDER_7')}
                >
                  <span className="pred-label">Under 7</span>
                  <span className="pred-multiplier">2.3x Payout</span>
                </button>
                <button 
                  disabled={rolling}
                  className={`pred-option-btn ${prediction === 'EXACT_7' ? 'active' : ''}`}
                  onClick={() => setPrediction('EXACT_7')}
                >
                  <span className="pred-label">Lucky 7 (Exact)</span>
                  <span className="pred-multiplier">5.8x Payout</span>
                </button>
                <button 
                  disabled={rolling}
                  className={`pred-option-btn ${prediction === 'OVER_7' ? 'active' : ''}`}
                  onClick={() => setPrediction('OVER_7')}
                >
                  <span className="pred-label">Over 7</span>
                  <span className="pred-multiplier">2.3x Payout</span>
                </button>
                <button 
                  disabled={rolling}
                  className={`pred-option-btn ${prediction === 'DOUBLES' ? 'active' : ''}`}
                  onClick={() => setPrediction('DOUBLES')}
                >
                  <span className="pred-label">Roll Doubles</span>
                  <span className="pred-multiplier">5.8x Payout</span>
                </button>
              </div>

              <div className="dice-payout-table-info">
                <h4>PROBABILITY MATRIX</h4>
                <ul>
                  <li><strong>Sum 2 or 12:</strong> Rare (2.7% chance)</li>
                  <li><strong>Sum 7:</strong> Common (16.6% chance)</li>
                  <li><strong>Sum &lt; 7:</strong> sum of 2, 3, 4, 5, 6 (41.6% chance)</li>
                  <li><strong>Sum &gt; 7:</strong> sum of 8, 9, 10, 11, 12 (41.6% chance)</li>
                </ul>
              </div>
            </div>
          ) : (
            <div className="tournament-details-card">
              <h3>🏆 ACTIVE LEADERBOARD</h3>
              <div className="panel-divider"></div>

              <div className="tourney-prize-pool-banner">
                <span className="banner-title">PRIZE POOL</span>
                <span className="banner-value">${activeTourney?.prize_pool.toFixed(2)}</span>
              </div>

              <div className="leaderboard-scroller">
                <table className="tourney-leaderboard-table">
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Username</th>
                      <th>Rolls Left</th>
                      <th>Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.length === 0 ? (
                      <tr>
                        <td colSpan="4" className="empty-leaderboard">No participants yet. Be the first to join!</td>
                      </tr>
                    ) : (
                      leaderboard.map((player, index) => {
                        const isSelf = player.email.toLowerCase() === currentUser.email.toLowerCase();
                        return (
                          <tr key={index} className={`${isSelf ? 'row-self' : ''}`}>
                            <td className="rank-cell">
                              {index === 0 && '🥇'}
                              {index === 1 && '🥈'}
                              {index === 2 && '🥉'}
                              {index > 2 && `${index + 1}`}
                            </td>
                            <td className="username-cell"><strong>{player.username}</strong></td>
                            <td>{player.rolls_left} rolls</td>
                            <td className="score-cell">{player.total_score}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

export default CyberDiceGame;
