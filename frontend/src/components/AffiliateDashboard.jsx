import React, { useState, useEffect } from 'react';

const RANK_DETAILS = {
  BRONZE: { multiplier: '5%', nextRank: 'SILVER', nextThreshold: 1000, color: '#cd7f32' },
  SILVER: { multiplier: '10%', nextRank: 'GOLD', nextThreshold: 10000, color: '#c0c0c0' },
  GOLD: { multiplier: '15%', nextRank: 'DIAMOND', nextThreshold: 100000, color: '#ffd700' },
  DIAMOND: { multiplier: '25%', nextRank: 'MAX RANK', nextThreshold: null, color: '#b9f2ff' }
};

export default function AffiliateDashboard({ userSession, onWalletUpdate }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/affiliate/stats?email=${encodeURIComponent(userSession.email)}`);
      const data = await res.json();
      if (data.success) {
        setStats(data);
        setError(null);
      } else {
        setError(data.error || 'Failed to fetch affiliate stats.');
      }
    } catch (err) {
      console.error(err);
      setError('Connection to backend failed.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (userSession?.email) {
      fetchStats();
    }
  }, [userSession]);

  const copyToClipboard = () => {
    if (!stats?.referralCode) return;
    const refLink = `${window.location.origin}/?ref=${stats.referralCode}`;
    navigator.clipboard.writeText(refLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClaimCommission = async () => {
    if (!stats || stats.commissionBalance <= 0 || claiming) return;

    try {
      setClaiming(true);
      setError(null);
      setSuccessMsg(null);

      const res = await fetch('/api/affiliate/claim-commission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userSession.email })
      });
      const data = await res.json();

      if (data.success) {
        setSuccessMsg(`Successfully claimed $${data.claimed.toFixed(2)} to your main balance!`);
        if (onWalletUpdate) onWalletUpdate(data.newBalance);
        fetchStats();
      } else {
        setError(data.error || 'Failed to claim commission.');
      }
    } catch (err) {
      console.error(err);
      setError('Network connection failed.');
    } finally {
      setClaiming(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '300px', color: '#fff', fontFamily: 'Orbitron' }}>
        LOADING AFFILIATE NETWORK...
      </div>
    );
  }

  const currentRank = stats?.currentRank || 'BRONZE';
  const rankInfo = RANK_DETAILS[currentRank];
  const networkVol = stats?.totalNetworkVolume || 0.0;
  
  // Calculate rank upgrade progress percentage
  let progressPct = 100;
  if (rankInfo.nextThreshold) {
    progressPct = Math.min(100, Math.max(0, (networkVol / rankInfo.nextThreshold) * 100));
  }

  const referralLink = stats ? `${window.location.origin}/?ref=${stats.referralCode}` : '';

  return (
    <div style={{
      maxWidth: '1000px',
      margin: '0 auto',
      padding: '20px',
      color: '#fff',
      display: 'flex',
      flexDirection: 'column',
      gap: '24px',
      fontFamily: 'Outfit'
    }}>
      
      {/* Page Header */}
      <div>
        <h1 style={{ fontFamily: 'Orbitron', fontSize: '2rem', letterSpacing: '1px', margin: 0, textShadow: '0 0 10px rgba(0, 255, 204, 0.2)', color: '#fff' }}>
          CYBER PARTNER NETWORK
        </h1>
        <p style={{ color: 'var(--text-gray)', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '2px', marginTop: '5px' }}>
          Invite players, grow your network, and earn dynamic wager commissions.
        </p>
      </div>

      {error && (
        <div style={{ background: 'rgba(255, 0, 85, 0.1)', border: '1px solid var(--neon-red)', borderRadius: '12px', padding: '15px', color: '#ff4477', fontSize: '14px' }}>
          ⚠️ {error}
        </div>
      )}

      {successMsg && (
        <div style={{ background: 'rgba(0, 255, 102, 0.1)', border: '1px solid var(--neon-green)', borderRadius: '12px', padding: '15px', color: 'var(--neon-green)', fontSize: '14px', textShadow: '0 0 5px rgba(0, 255, 102, 0.2)' }}>
          ✅ {successMsg}
        </div>
      )}

      {/* Grid container */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
        
        {/* Left Column: Link sharing & Bounty */}
        <div style={{
          background: 'rgba(10, 14, 18, 0.7)',
          border: '1px solid var(--glass-border)',
          borderRadius: '16px',
          padding: '24px',
          backdropFilter: 'blur(15px)',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px'
        }}>
          <div>
            <h2 style={{ fontFamily: 'Orbitron', fontSize: '14px', letterSpacing: '1.5px', color: 'var(--neon-blue)', margin: '0 0 5px 0' }}>
              SHARE YOUR LINK
            </h2>
            <p style={{ fontSize: '12px', color: 'var(--text-gray)', margin: 0 }}>
              Earn a $10 welcome bounty whenever referees deposit $15 or wager $50. Referees also receive locked bonus drops.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
            <input 
              type="text" 
              readOnly 
              value={referralLink} 
              style={{
                flex: 1,
                background: 'rgba(0,0,0,0.5)',
                border: '1px solid var(--glass-border)',
                borderRadius: '8px',
                padding: '12px',
                color: '#fff',
                fontSize: '12px',
                outline: 'none',
                fontFamily: 'monospace'
              }}
            />
            <button 
              onClick={copyToClipboard}
              style={{
                background: copied ? 'var(--neon-green)' : 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px',
                color: copied ? '#000' : '#fff',
                padding: '0 15px',
                fontSize: '12px',
                fontWeight: 'bold',
                cursor: 'pointer',
                transition: 'all 0.2s',
                fontFamily: 'Orbitron'
              }}
            >
              {copied ? 'COPIED' : 'COPY'}
            </button>
          </div>

          {/* Quick Code display */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '12px 16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.03)' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-gray)' }}>REFERRAL CODE</span>
            <span style={{ fontSize: '14px', fontFamily: 'Orbitron', fontWeight: 'bold', color: 'var(--neon-green)' }}>{stats?.referralCode}</span>
          </div>
        </div>

        {/* Right Column: Rank & Comm Wallet */}
        <div style={{
          background: 'rgba(10, 14, 18, 0.7)',
          border: '1px solid var(--glass-border)',
          borderRadius: '16px',
          padding: '24px',
          backdropFilter: 'blur(15px)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: '20px'
        }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 0 5px 0' }}>
              <h2 style={{ fontFamily: 'Orbitron', fontSize: '14px', letterSpacing: '1.5px', color: 'var(--neon-blue)', margin: 0 }}>
                AFFILIATE RANK
              </h2>
              <span style={{
                background: rankInfo.color,
                color: '#000',
                fontSize: '10px',
                fontFamily: 'Orbitron',
                fontWeight: 'bold',
                padding: '2px 8px',
                borderRadius: '4px'
              }}>
                {currentRank}
              </span>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-gray)', margin: 0 }}>
              You earn **{rankInfo.multiplier}** of the house edge on all referred bets!
            </p>
          </div>

          {/* Progress bar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-gray)', fontFamily: 'Orbitron' }}>
              <span>NET VOLUME: ${networkVol.toFixed(2)}</span>
              {rankInfo.nextThreshold ? (
                <span>NEXT: ${rankInfo.nextThreshold.toLocaleString()} ({rankInfo.nextRank})</span>
              ) : (
                <span>DIAMOND (MAX LEVEL)</span>
              )}
            </div>
            <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ width: `${progressPct}%`, height: '100%', background: `linear-gradient(90deg, var(--neon-blue), ${rankInfo.color})`, borderRadius: '4px', boxShadow: `0 0 10px ${rankInfo.color}` }} />
            </div>
          </div>

          {/* Commission Wallet */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', background: 'rgba(0,0,0,0.4)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div>
              <span style={{ fontSize: '11px', color: 'var(--text-gray)', textTransform: 'uppercase', letterSpacing: '1px' }}>COMMISSION WALLET</span>
              <div style={{ fontSize: '1.8rem', fontFamily: 'Orbitron', fontWeight: 'bold', color: 'var(--neon-green)', textShadow: '0 0 10px rgba(0,255,102,0.1)', marginTop: '4px' }}>
                ${stats ? stats.commissionBalance.toFixed(4) : '0.0000'}
              </div>
            </div>
            <button
              onClick={handleClaimCommission}
              disabled={!stats || stats.commissionBalance <= 0 || claiming}
              style={{
                background: stats?.commissionBalance > 0 ? 'var(--neon-green)' : 'rgba(255, 255, 255, 0.03)',
                border: 'none',
                borderRadius: '8px',
                color: stats?.commissionBalance > 0 ? '#000' : 'rgba(255,255,255,0.2)',
                fontFamily: 'Orbitron',
                fontWeight: 'bold',
                padding: '12px 16px',
                cursor: stats?.commissionBalance > 0 ? 'pointer' : 'not-allowed',
                boxShadow: stats?.commissionBalance > 0 ? '0 0 15px rgba(0,255,102,0.2)' : 'none',
                transition: 'all 0.2s'
              }}
            >
              {claiming ? 'CLAIMING...' : 'CLAIM EARNINGS'}
            </button>
          </div>

        </div>

      </div>

      {/* Referrals list */}
      <div style={{
        background: 'rgba(10, 14, 18, 0.7)',
        border: '1px solid var(--glass-border)',
        borderRadius: '16px',
        padding: '24px',
        backdropFilter: 'blur(15px)'
      }}>
        <h2 style={{ fontFamily: 'Orbitron', fontSize: '14px', letterSpacing: '1.5px', color: 'var(--neon-blue)', margin: '0 0 15px 0' }}>
          REFERRED PLAYERS
        </h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-gray)' }}>
                <th style={{ padding: '12px 10px' }}>REFEREE EMAIL</th>
                <th style={{ padding: '12px 10px' }}>STATUS</th>
                <th style={{ padding: '12px 10px' }}>JOIN DATE</th>
              </tr>
            </thead>
            <tbody>
              {!stats?.referrals || stats.referrals.length === 0 ? (
                <tr>
                  <td colSpan="3" style={{ padding: '24px 10px', textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontFamily: 'Outfit' }}>
                    No referred players logged. Share your link above to build your network!
                  </td>
                </tr>
              ) : (
                stats.referrals.map((r, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                    <td style={{ padding: '12px 10px', fontFamily: 'monospace' }}>{r.referee_email}</td>
                    <td style={{ padding: '12px 10px' }}>
                      <span style={{
                        background: r.status === 'BOUNTY_CLAIMED' ? 'rgba(0, 255, 102, 0.1)' : 'rgba(255, 191, 0, 0.1)',
                        color: r.status === 'BOUNTY_CLAIMED' ? 'var(--neon-green)' : 'rgba(255, 191, 0, 0.8)',
                        fontSize: '10px',
                        fontFamily: 'Orbitron',
                        fontWeight: 'bold',
                        padding: '2px 8px',
                        borderRadius: '4px'
                      }}>
                        {r.status === 'BOUNTY_CLAIMED' ? 'BOUNTY CLAIMED' : 'PENDING'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 10px', color: 'var(--text-gray)' }}>
                      {new Date(r.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
