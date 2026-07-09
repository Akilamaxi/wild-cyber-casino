import React, { useState } from 'react';

export default function CrashHistoryTable({ history }) {
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 5;
  const totalPages = Math.ceil(history.length / rowsPerPage) || 1;

  const startIndex = (currentPage - 1) * rowsPerPage;
  const currentRows = history.slice(startIndex, startIndex + rowsPerPage);

  return (
    <div style={{ background: '#0a0d10', borderRadius: '12px', border: '1px solid #1a1e23', overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: '#12161b', padding: '15px 20px', borderBottom: '1px solid #1a1e23', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ color: '#fff', margin: 0, fontSize: '14px', borderBottom: '2px solid #ffaa00', paddingBottom: '14px', marginBottom: '-15px' }}>My Bets</h3>
        <div style={{ color: '#6b7280', fontSize: '12px' }}>
          Page {currentPage} of {totalPages}
        </div>
      </div>
      
      <div style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden' }} className="hidden-scrollbar">
        <style>
          {`
            .hidden-scrollbar::-webkit-scrollbar {
              display: none;
            }
            .hidden-scrollbar {
              -ms-overflow-style: none;
              scrollbar-width: none;
            }
          `}
        </style>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px', whiteSpace: 'nowrap' }}>
          <thead style={{ background: '#0a0d10' }}>
            <tr style={{ color: '#6b7280' }}>
              <th style={{ padding: '12px 15px', fontWeight: 'normal' }}>Time</th>
              <th style={{ padding: '12px 15px', fontWeight: 'normal' }}>Bet Amount</th>
              <th style={{ padding: '12px 15px', fontWeight: 'normal' }}>Multiplier</th>
              <th style={{ padding: '12px 15px', fontWeight: 'normal' }}>Crash Point</th>
              <th style={{ padding: '12px 15px', fontWeight: 'normal', textAlign: 'right' }}>Payout</th>
            </tr>
          </thead>
          <tbody>
            {currentRows.map(bet => {
              const isWin = bet.status === 'WON';
              return (
                <tr key={bet.id} style={{ borderBottom: '1px solid #12161b' }}>
                  <td style={{ padding: '12px 15px', color: '#6b7280' }}>
                    {new Date(bet.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td style={{ padding: '12px 15px', color: '#e5e7eb' }}>${bet.betAmount.toFixed(2)}</td>
                  <td style={{ padding: '12px 15px', color: isWin ? '#00ff66' : '#6b7280' }}>
                    {bet.cashoutMultiplier ? `${bet.cashoutMultiplier.toFixed(2)}x` : '-'}
                  </td>
                  <td style={{ padding: '12px 15px', color: '#ff0055' }}>
                    {bet.crashPoint ? `${bet.crashPoint.toFixed(2)}x` : '-'}
                  </td>
                  <td style={{ padding: '12px 15px', textAlign: 'right', color: isWin ? '#00ff66' : '#e5e7eb' }}>
                    {bet.winnings ? `+$${bet.winnings.toFixed(2)}` : '-'}
                  </td>
                </tr>
              );
            })}
            {history.length === 0 && (
              <tr>
                <td colSpan="5" style={{ padding: '30px', textAlign: 'center', color: '#6b7280' }}>
                  You haven't placed any bets yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      {history.length > 0 && (
        <div style={{ padding: '10px 20px', borderTop: '1px solid #1a1e23', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button 
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            style={{ padding: '5px 10px', background: '#12161b', color: currentPage === 1 ? '#333' : '#e5e7eb', border: '1px solid #1a1e23', borderRadius: '4px', cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}
          >
            Prev
          </button>
          <button 
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            style={{ padding: '5px 10px', background: '#12161b', color: currentPage === totalPages ? '#333' : '#e5e7eb', border: '1px solid #1a1e23', borderRadius: '4px', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer' }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
