import React, { useState, useEffect } from 'react';

const BACKOFFICE_API = '';

function BackofficeDashboard({ currentUser }) {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [formData, setFormData] = useState({
    id: '', name: '', draw_interval_ms: 60000, ticket_price: 10, max_tickets_per_user: 100, house_edge_percentage: 0.30, status: 'ACTIVE'
  });

  useEffect(() => {
    fetchGames();
  }, []);

  const fetchGames = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BACKOFFICE_API}/api/admin/games`);
      const data = await res.json();
      if (data.success) {
        setGames(data.games);
      } else {
        setError('Failed to fetch games config');
      }
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${BACKOFFICE_API}/api/admin/games`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      const data = await res.json();
      if (data.success) {
        alert('Game configuration successfully saved and broadcasted!');
        fetchGames();
      } else {
        alert('Error: ' + data.error);
      }
    } catch (err) {
      alert('Error connecting to backoffice: ' + err.message);
    }
  };

  const toggleStatus = async (game) => {
    const newStatus = game.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    try {
      await fetch(`${BACKOFFICE_API}/api/admin/games/${game.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...game, status: newStatus })
      });
      fetchGames();
    } catch (err) {
      alert('Error updating status');
    }
  };

  if (currentUser?.role !== 'ADMIN') {
    return (
      <div className="lottery-page-container" style={{ padding: '40px', textAlign: 'center' }}>
        <h2>ACCESS DENIED</h2>
        <p>You do not have administrative privileges to view the Back-Office console.</p>
      </div>
    );
  }

  return (
    <div className="lottery-page-container" style={{ padding: '20px', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ color: 'var(--forest-gold)' }}>🛡️ CYBER CASINO BACK-OFFICE</h2>
        <button onClick={fetchGames} className="history-btn" style={{ marginTop: '0' }}>REFRESH CONFIGS</button>
      </div>

      <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
        
        {/* CREATE GAME FORM */}
        <div style={{ flex: '1', background: 'rgba(0,0,0,0.5)', padding: '20px', borderRadius: '12px', border: '1px solid var(--forest-gold)' }}>
          <h3 style={{ color: '#fff', marginBottom: '15px' }}>ADD NEW LOTTERY GAME</h3>
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <input type="text" placeholder="Unique Game ID (e.g., GAME-10)" value={formData.id} onChange={e => setFormData({...formData, id: e.target.value})} required className="history-search-input" />
            <input type="text" placeholder="Display Name (e.g., Turbo Rush)" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required className="history-search-input" />
            <div>
              <label style={{ fontSize: '0.8rem', color: '#ccc' }}>Draw Interval (ms):</label>
              <input type="number" value={formData.draw_interval_ms} onChange={e => setFormData({...formData, draw_interval_ms: parseInt(e.target.value)})} required className="history-search-input" style={{ width: '100%', marginTop: '5px' }} />
            </div>
            <div>
              <label style={{ fontSize: '0.8rem', color: '#ccc' }}>Ticket Price ($):</label>
              <input type="number" step="0.1" value={formData.ticket_price} onChange={e => setFormData({...formData, ticket_price: parseFloat(e.target.value)})} required className="history-search-input" style={{ width: '100%', marginTop: '5px' }} />
            </div>
            <div>
              <label style={{ fontSize: '0.8rem', color: '#ccc' }}>House Edge (0.0 to 1.0):</label>
              <input type="number" step="0.01" value={formData.house_edge_percentage} onChange={e => setFormData({...formData, house_edge_percentage: parseFloat(e.target.value)})} required className="history-search-input" style={{ width: '100%', marginTop: '5px' }} />
            </div>
            <button type="submit" className="history-btn" style={{ width: '100%' }}>DEPLOY GAME</button>
          </form>
        </div>

        {/* GAMES LIST */}
        <div style={{ flex: '2', background: 'rgba(0,0,0,0.5)', padding: '20px', borderRadius: '12px', border: '1px solid #333' }}>
          <h3 style={{ color: '#fff', marginBottom: '15px' }}>ACTIVE GAME CONFIGURATIONS</h3>
          {loading ? <p>Loading...</p> : (
            <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', color: '#eee' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #444', color: 'var(--forest-gold)' }}>
                  <th style={{ padding: '10px' }}>ID</th>
                  <th style={{ padding: '10px' }}>Name</th>
                  <th style={{ padding: '10px' }}>Interval</th>
                  <th style={{ padding: '10px' }}>Ticket Price</th>
                  <th style={{ padding: '10px' }}>House Edge</th>
                  <th style={{ padding: '10px' }}>Status</th>
                  <th style={{ padding: '10px' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {games.map(g => (
                  <tr key={g.id} style={{ borderBottom: '1px solid #222' }}>
                    <td style={{ padding: '10px' }}>{g.id}</td>
                    <td style={{ padding: '10px' }}>{g.name}</td>
                    <td style={{ padding: '10px' }}>{g.draw_interval_ms / 1000}s</td>
                    <td style={{ padding: '10px' }}>${g.ticket_price}</td>
                    <td style={{ padding: '10px' }}>{(g.house_edge_percentage * 100).toFixed(0)}%</td>
                    <td style={{ padding: '10px', color: g.status === 'ACTIVE' ? '#4ade80' : '#f87171' }}>{g.status}</td>
                    <td style={{ padding: '10px' }}>
                      <button onClick={() => toggleStatus(g)} style={{ padding: '4px 8px', background: '#333', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                        {g.status === 'ACTIVE' ? 'Pause' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default BackofficeDashboard;
