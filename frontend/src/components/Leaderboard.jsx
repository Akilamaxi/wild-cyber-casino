import React, { useState, useEffect } from 'react';

function Leaderboard({ currentUser }) {
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLeaderboard();
  }, []);

  const fetchLeaderboard = async () => {
    try {
      const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:5000' : '';
      const response = await fetch(`${API_BASE}/api/leaderboard`);
      const data = await response.json();
      if (data.success) {
        setLeaderboard(data.leaderboard);
      }
    } catch (err) {
      console.error('Failed to load leaderboard:', err);
    } finally {
      setLoading(false);
    }
  };

  const getRankBadge = (index) => {
    const rank = index + 1;
    if (rank === 1) return <span className="rank-badge gold" title="1st Place">🥇 1</span>;
    if (rank === 2) return <span className="rank-badge silver" title="2nd Place">🥈 2</span>;
    if (rank === 3) return <span className="rank-badge bronze" title="3rd Place">🥉 3</span>;
    return <span className="rank-badge-standard">{rank}</span>;
  };

  return (
    <div className="leaderboard-container">
      <h2 className="panel-title">CYBER CASINO LEADERBOARD</h2>
      <p className="panel-subtitle">Top high rollers in the lobby. Spin the wheel to claim your spot!</p>
      <div className="section-divider"></div>

      <div className="leaderboard-table-section">
        {loading ? (
          <div className="loader-placeholder">LOADING LEADERBOARD STATS...</div>
        ) : (
          <div className="table-responsive">
            <table className="leaderboard-table">
              <thead>
                <tr>
                  <th>RANK</th>
                  <th>PLAYER</th>
                  <th>GAMES PLAYED</th>
                  <th>TOTAL WON</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((player, index) => {
                  const isSelf = currentUser && player.username === currentUser.username;
                  return (
                    <tr 
                      key={player.username} 
                      className={`leaderboard-row ${isSelf ? 'highlight-self' : ''}`}
                    >
                      <td>{getRankBadge(index)}</td>
                      <td>
                        <div className="player-name-cell">
                          <span className="player-avatar">👤</span>
                          <span className="player-name">
                            {player.username} {isSelf && <span className="self-label">(YOU)</span>}
                          </span>
                        </div>
                      </td>
                      <td className="games-count-cell">{player.gamesPlayed}</td>
                      <td className="total-won-cell">${player.totalWon.toLocaleString()}</td>
                      <td>
                        <span className={`status-pill ${player.isOnline || isSelf ? 'online' : 'offline'}`}>
                          {player.isOnline || isSelf ? 'ONLINE' : 'OFFLINE'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Leaderboard Tips Banner */}
      <div className="leaderboard-tips-banner">
        💡 <strong>Tip:</strong> Payouts from spin wins increase your total winnings directly. The bigger you win, the faster you climb!
      </div>
    </div>
  );
}

export default Leaderboard;
