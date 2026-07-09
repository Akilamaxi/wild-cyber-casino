import React from 'react';

export default function CrashPlayersTable({ activeBets }) {
  return (
    <div style={{ background: '#0a0d10', borderRadius: '12px', border: '1px solid #1a1e23', overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <style>
        {`
          .neon-scrollbar::-webkit-scrollbar {
            width: 6px;
          }
          .neon-scrollbar::-webkit-scrollbar-track {
            background: rgba(0, 0, 0, 0.2);
            border-radius: 10px;
          }
          .neon-scrollbar::-webkit-scrollbar-thumb {
            background: #ffea00;
            border-radius: 10px;
            box-shadow: inset 0 0 6px rgba(255, 234, 0, 0.8);
          }
          .neon-scrollbar::-webkit-scrollbar-thumb:hover {
            background: #ffff00;
          }
        `}
      </style>
      <div style={{ background: '#12161b', padding: '15px 20px', borderBottom: '1px solid #1a1e23', display: 'flex', gap: '20px' }}>
        <h3 style={{ color: '#fff', margin: 0, fontSize: '14px', borderBottom: '2px solid #ffaa00', paddingBottom: '14px', marginBottom: '-15px' }}>All Bets</h3>
      </div>
      
      <div className="neon-scrollbar" style={{ flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
          <thead style={{ position: 'sticky', top: 0, background: '#0a0d10', zIndex: 1 }}>
            <tr style={{ color: '#6b7280' }}>
              <th style={{ padding: '12px 20px', fontWeight: 'normal' }}>User</th>
              <th style={{ padding: '12px 20px', fontWeight: 'normal' }}>Bet</th>
              <th style={{ padding: '12px 20px', fontWeight: 'normal' }}>Multiplier</th>
              <th style={{ padding: '12px 20px', fontWeight: 'normal', textAlign: 'right' }}>Payout</th>
            </tr>
          </thead>
          <tbody>
            {activeBets.map(bet => (
              <tr key={bet.id} style={{ 
                borderBottom: '1px solid #12161b',
                background: bet.status === 'WON' ? 'rgba(0, 255, 102, 0.05)' : (bet.status === 'LOST' ? 'rgba(255, 0, 85, 0.05)' : 'transparent')
              }}>
                <td style={{ padding: '12px 20px', color: '#e5e7eb' }}>{bet.username}</td>
                <td style={{ padding: '12px 20px', color: '#e5e7eb' }}>${bet.betAmount.toFixed(2)}</td>
                <td style={{ padding: '12px 20px', color: bet.cashoutMultiplier ? '#00ff66' : '#6b7280' }}>
                  {bet.cashoutMultiplier ? `${bet.cashoutMultiplier.toFixed(2)}x` : '-'}
                </td>
                <td style={{ padding: '12px 20px', textAlign: 'right', color: bet.winnings ? '#00ff66' : '#e5e7eb' }}>
                  {bet.winnings ? `+$${bet.winnings.toFixed(2)}` : '-'}
                </td>
              </tr>
            ))}
            {activeBets.length === 0 && (
              <tr>
                <td colSpan="4" style={{ padding: '30px', textAlign: 'center', color: '#6b7280' }}>
                  No bets placed yet in this round.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
