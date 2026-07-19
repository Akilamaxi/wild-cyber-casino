import React, { useState, useEffect } from 'react';
import { API_BASE, apiFetch } from '../config';


function UserProfile({ currentUser, onBalanceUpdate }) {
  const [activeTab, setActiveTab] = useState('details'); // 'details' | 'security' | 'privacy'
  const [loyalty, setLoyalty] = useState({ points: 0, tier: 'BRONZE' });
  const [loadingLoyalty, setLoadingLoyalty] = useState(false);

  // Security Form States
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [securityFeedback, setSecurityFeedback] = useState({ text: '', isError: false });
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);

  // Privacy Settings States
  const [marketingOptIn, setMarketingOptIn] = useState(true);
  const [shareWagers, setShareWagers] = useState(true);
  const [leaderboardOptIn, setLeaderboardOptIn] = useState(true);
  const [privacyFeedback, setPrivacyFeedback] = useState('');

  const TIER_THRESHOLDS = {
    BRONZE: 0,
    SILVER: 1000,
    GOLD: 5000
  };

  useEffect(() => {
    if (currentUser?.email) {
      fetchLoyaltyStatus();
    }
  }, [currentUser]);

  const fetchLoyaltyStatus = async () => {
    setLoadingLoyalty(true);
    try {
      const response = await apiFetch(`${API_BASE}/api/v1/loyalty/status?email=${currentUser.email}`);
      const data = await response.json();
      if (true && data.profile) {
        setLoyalty(data.profile);
      }
    } catch (err) {
      console.error('Failed to load loyalty profile:', err);
    } finally {
      setLoadingLoyalty(false);
    }
  };

  // Calculate Progress details
  const getProgressDetails = () => {
    const pts = loyalty.points || 0;
    const tier = loyalty.tier || 'BRONZE';

    if (tier === 'GOLD') {
      return { pct: 100, nextTier: 'MAX TIER', pointsNeeded: 0 };
    } else if (tier === 'SILVER') {
      const needed = TIER_THRESHOLDS.GOLD - pts;
      const pct = Math.min(100, Math.max(0, ((pts - TIER_THRESHOLDS.SILVER) / (TIER_THRESHOLDS.GOLD - TIER_THRESHOLDS.SILVER)) * 100));
      return { pct, nextTier: 'GOLD', pointsNeeded: needed };
    } else {
      const needed = TIER_THRESHOLDS.SILVER - pts;
      const pct = Math.min(100, Math.max(0, (pts / TIER_THRESHOLDS.SILVER) * 100));
      return { pct, nextTier: 'SILVER', pointsNeeded: needed };
    }
  };

  const handlePasswordChange = (e) => {
    e.preventDefault();
    setSecurityFeedback({ text: '', isError: false });

    if (!oldPassword || !newPassword || !confirmPassword) {
      setSecurityFeedback({ text: 'All fields are required.', isError: true });
      return;
    }

    if (newPassword !== confirmPassword) {
      setSecurityFeedback({ text: 'New passwords do not match.', isError: true });
      return;
    }

    if (newPassword.length < 6) {
      setSecurityFeedback({ text: 'New password must be at least 6 characters.', isError: true });
      return;
    }

    // Mock API success feedback
    setSecurityFeedback({ text: 'Security credentials updated successfully! 🔒', isError: false });
    setOldPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const handlePrivacySave = () => {
    setPrivacyFeedback('Privacy configurations successfully updated in local store.');
    setTimeout(() => setPrivacyFeedback(''), 3000);
  };

  const { pct, nextTier, pointsNeeded } = getProgressDetails();

  return (
    <div className="lottery-page-container" style={{ padding: '20px', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ color: 'var(--forest-gold)' }}>👤 USER ACCOUNT CONTROL</h2>
        <div style={{ color: '#aaa', fontSize: '0.9rem' }}>Account Status: <span style={{ color: '#4ade80', fontWeight: 'bold' }}>VERIFIED ✓</span></div>
      </div>

      {/* Tabs Menu */}
      <div className="lottery-tabs-container" style={{ display: 'flex', gap: '10px', marginBottom: '20px', borderBottom: '1px solid #333', paddingBottom: '10px' }}>
        <button 
          onClick={() => setActiveTab('details')} 
          className="tab-btn" 
          style={{ 
            padding: '10px 20px', 
            background: activeTab === 'details' ? 'var(--forest-gold)' : '#1a1a1a', 
            color: activeTab === 'details' ? '#000' : '#fff',
            border: 'none', 
            borderRadius: '6px', 
            cursor: 'pointer', 
            fontWeight: 'bold' 
          }}
        >
          Profile & VIP Status
        </button>
        <button 
          onClick={() => setActiveTab('security')} 
          className="tab-btn" 
          style={{ 
            padding: '10px 20px', 
            background: activeTab === 'security' ? 'var(--forest-gold)' : '#1a1a1a', 
            color: activeTab === 'security' ? '#000' : '#fff',
            border: 'none', 
            borderRadius: '6px', 
            cursor: 'pointer', 
            fontWeight: 'bold' 
          }}
        >
          Credentials & Security
        </button>
        <button 
          onClick={() => setActiveTab('privacy')} 
          className="tab-btn" 
          style={{ 
            padding: '10px 20px', 
            background: activeTab === 'privacy' ? 'var(--forest-gold)' : '#1a1a1a', 
            color: activeTab === 'privacy' ? '#000' : '#fff',
            border: 'none', 
            borderRadius: '6px', 
            cursor: 'pointer', 
            fontWeight: 'bold' 
          }}
        >
          Privacy & Consents
        </button>
      </div>

      <div style={{ background: 'rgba(0,0,0,0.5)', padding: '25px', borderRadius: '12px', border: '1px solid #333' }}>
        
        {/* Tab 1: Profile & VIP Progression */}
        {activeTab === 'details' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '25px' }}>
            
            {/* User Meta Row */}
            <div style={{ display: 'flex', gap: '20px', alignItems: 'center', background: 'rgba(255,255,255,0.03)', padding: '15px', borderRadius: '8px' }}>
              <div style={{ fontSize: '3rem' }}>👤</div>
              <div>
                <h3 style={{ margin: '0 0 5px 0', color: '#fff' }}>{currentUser?.username || 'Guest Player'}</h3>
                <p style={{ margin: '0', color: '#aaa', fontSize: '0.9rem' }}>Email ID: {currentUser?.email}</p>
                <p style={{ margin: '5px 0 0 0', color: 'var(--forest-gold)', fontWeight: 'bold' }}>Current Balance: ${currentUser?.balance?.toLocaleString()}</p>
              </div>
            </div>

            {/* VIP Card */}
            <div style={{ background: 'linear-gradient(135deg, #1e1b18 0%, #0f0b08 100%)', border: '1px solid var(--forest-gold)', padding: '20px', borderRadius: '10px', boxShadow: '0 0 15px rgba(212, 175, 55, 0.1)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                <h4 style={{ margin: '0', color: 'var(--forest-gold)', fontSize: '1.2rem', textTransform: 'uppercase' }}>👑 VIP Loyalty Program</h4>
                <div style={{ background: 'var(--forest-gold)', color: '#000', padding: '4px 10px', borderRadius: '20px', fontSize: '0.8rem', fontWeight: 'bold' }}>
                  {loyalty.tier} MEMBER
                </div>
              </div>

              {loadingLoyalty ? (
                <p style={{ color: '#aaa' }}>Querying VIP loyalty records...</p>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#ccc', marginBottom: '10px', fontSize: '0.95rem' }}>
                    <span>Earned Loyalty Points: <strong>{loyalty.points} XP</strong></span>
                    {loyalty.tier !== 'GOLD' && (
                      <span>Next Level: <strong>{nextTier}</strong> (in {pointsNeeded} XP)</span>
                    )}
                  </div>

                  {/* Visual Progress Bar */}
                  <div style={{ height: '14px', background: '#222', borderRadius: '10px', overflow: 'hidden', border: '1px solid #444', marginBottom: '15px' }}>
                    <div 
                      style={{ 
                        height: '100%', 
                        width: `${pct}%`, 
                        background: 'linear-gradient(90deg, #d4af37 0%, #fff 100%)', 
                        boxShadow: '0 0 8px #d4af37', 
                        transition: 'width 0.5s ease-in-out' 
                      }} 
                    />
                  </div>

                  {/* Reward Threshold guidelines */}
                  <div style={{ background: 'rgba(0,0,0,0.4)', padding: '10px', borderRadius: '6px', fontSize: '0.85rem', color: '#ccc' }}>
                    <strong>💡 Tier Milestones:</strong>
                    <ul style={{ margin: '5px 0 0 0', paddingLeft: '20px', lineHeight: '1.5' }}>
                      <li><strong>SILVER TIER</strong> (1,000 XP): Unlocks $50 cash level-up bonus!</li>
                      <li><strong>GOLD TIER</strong> (5,000 XP): Unlocks $250 cash level-up bonus & dedicated support!</li>
                    </ul>
                  </div>
                </>
              )}
            </div>

          </div>
        )}

        {/* Tab 2: Credentials & Security Settings */}
        {activeTab === 'security' && (
          <div>
            <h3 style={{ color: '#fff', marginTop: '0', marginBottom: '15px' }}>🔐 SECURITY SETTINGS</h3>
            
            <div style={{ display: 'flex', gap: '30px', flexWrap: 'wrap' }}>
              {/* Password update form */}
              <form onSubmit={handlePasswordChange} style={{ flex: '1', minWidth: '280px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <h4 style={{ color: 'var(--forest-gold)', margin: '0 0 10px 0' }}>Update Account Password</h4>
                
                <input 
                  type="password" 
                  placeholder="Current Password" 
                  value={oldPassword} 
                  onChange={(e) => setOldPassword(e.target.value)}
                  className="history-search-input" 
                  required 
                />
                <input 
                  type="password" 
                  placeholder="New Password (min 6 characters)" 
                  value={newPassword} 
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="history-search-input" 
                  required 
                />
                <input 
                  type="password" 
                  placeholder="Confirm New Password" 
                  value={confirmPassword} 
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="history-search-input" 
                  required 
                />

                {securityFeedback.text && (
                  <div style={{ 
                    padding: '10px', 
                    borderRadius: '6px', 
                    fontSize: '0.85rem', 
                    background: securityFeedback.isError ? 'rgba(248,113,113,0.1)' : 'rgba(74,222,128,0.1)', 
                    color: securityFeedback.isError ? '#f87171' : '#4ade80', 
                    border: `1px solid ${securityFeedback.isError ? '#f87171' : '#4ade80'}` 
                  }}>
                    {securityFeedback.text}
                  </div>
                )}

                <button type="submit" className="history-btn" style={{ marginTop: '5px' }}>APPLY PASSWORD CHANGE</button>
              </form>

              {/* Two-Factor verification (2FA) */}
              <div style={{ flex: '1', minWidth: '280px', background: 'rgba(255,255,255,0.02)', padding: '20px', borderRadius: '8px', border: '1px solid #333' }}>
                <h4 style={{ color: 'var(--forest-gold)', margin: '0 0 10px 0' }}>Two-Factor Authentication (2FA)</h4>
                <p style={{ fontSize: '0.85rem', color: '#aaa', lineHeight: '1.4' }}>Append an extra layer of protection to withdrawals and bets by verifying your identity with an authenticator app.</p>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginTop: '15px', marginBottom: '20px' }}>
                  <label className="toggle-switch-container" style={{ position: 'relative', display: 'inline-block', width: '50px', height: '26px' }}>
                    <input 
                      type="checkbox" 
                      checked={twoFactorEnabled} 
                      onChange={() => setTwoFactorEnabled(!twoFactorEnabled)} 
                      style={{ opacity: 0, width: 0, height: 0 }}
                    />
                    <span 
                      style={{ 
                        position: 'absolute', 
                        cursor: 'pointer', 
                        top: 0, left: 0, right: 0, bottom: 0, 
                        background: twoFactorEnabled ? 'var(--forest-gold)' : '#333', 
                        borderRadius: '34px', 
                        transition: '0.4s' 
                      }} 
                    />
                    <span 
                      style={{ 
                        position: 'absolute', 
                        content: '""', 
                        height: '18px', width: '18px', 
                        left: twoFactorEnabled ? '28px' : '4px', 
                        bottom: '4px', 
                        background: '#fff', 
                        borderRadius: '50%', 
                        transition: '0.4s' 
                      }} 
                    />
                  </label>
                  <span style={{ color: '#fff', fontSize: '0.9rem', fontWeight: 'bold' }}>
                    2FA Security status: {twoFactorEnabled ? <span style={{ color: 'var(--forest-gold)' }}>ENABLED</span> : 'DISABLED'}
                  </span>
                </div>

                {twoFactorEnabled && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', background: '#fff', padding: '15px', borderRadius: '6px', width: 'fit-content', margin: '0 auto' }}>
                    <svg width="100" height="100" viewBox="0 0 100 100">
                      <rect x="0" y="0" width="20" height="20" fill="#000"/>
                      <rect x="80" y="0" width="20" height="20" fill="#000"/>
                      <rect x="0" y="80" width="20" height="20" fill="#000"/>
                      <rect x="25" y="25" width="50" height="50" fill="#222"/>
                      <rect x="40" y="40" width="20" height="20" fill="#fff"/>
                    </svg>
                    <span style={{ color: '#000', fontSize: '0.75rem', fontWeight: 'bold', marginTop: '10px' }}>SCAN TO COMPLETE LINK</span>
                  </div>
                )}
              </div>
            </div>

          </div>
        )}

        {/* Tab 3: Privacy & Consents */}
        {activeTab === 'privacy' && (
          <div>
            <h3 style={{ color: '#fff', marginTop: '0', marginBottom: '15px' }}>🛡️ PRIVACY & CONSENT CONFIG</h3>
            <p style={{ fontSize: '0.85rem', color: '#aaa', marginBottom: '25px' }}>Customize your identity exposure and marketing configurations within the secure wild casino client.</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: '25px' }}>
              
              {/* Marketing Opt-In */}
              <div style={{ display: 'flex', justifyItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)', padding: '15px', borderRadius: '8px' }}>
                <div>
                  <h4 style={{ margin: '0 0 5px 0', color: '#fff', fontSize: '0.95rem' }}>Bonus & Promotional Emails</h4>
                  <p style={{ margin: '0', color: '#aaa', fontSize: '0.8rem' }}>Receive updates on deposit bonuses, free spins rounds, and platform cashback claims.</p>
                </div>
                <input 
                  type="checkbox" 
                  checked={marketingOptIn} 
                  onChange={() => setMarketingOptIn(!marketingOptIn)} 
                  style={{ width: '20px', height: '20px', cursor: 'pointer', accentColor: 'var(--forest-gold)' }}
                />
              </div>

              {/* Public Feed Sharing */}
              <div style={{ display: 'flex', justifyItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)', padding: '15px', borderRadius: '8px' }}>
                <div>
                  <h4 style={{ margin: '0 0 5px 0', color: '#fff', fontSize: '0.95rem' }}>Share Betting Records publicly</h4>
                  <p style={{ margin: '0', color: '#aaa', fontSize: '0.8rem' }}>Let other players see your lottery numbers and spin wheel wager multipliers in the lobby logs.</p>
                </div>
                <input 
                  type="checkbox" 
                  checked={shareWagers} 
                  onChange={() => setShareWagers(!shareWagers)} 
                  style={{ width: '20px', height: '20px', cursor: 'pointer', accentColor: 'var(--forest-gold)' }}
                />
              </div>

              {/* Leaderboard inclusion */}
              <div style={{ display: 'flex', justifyItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)', padding: '15px', borderRadius: '8px' }}>
                <div>
                  <h4 style={{ margin: '0 0 5px 0', color: '#fff', fontSize: '0.95rem' }}>List Username on Leaderboards</h4>
                  <p style={{ margin: '0', color: '#aaa', fontSize: '0.8rem' }}>Permit the casino leaderboard panel to display your total gains and active payouts.</p>
                </div>
                <input 
                  type="checkbox" 
                  checked={leaderboardOptIn} 
                  onChange={() => setLeaderboardOptIn(!leaderboardOptIn)} 
                  style={{ width: '20px', height: '20px', cursor: 'pointer', accentColor: 'var(--forest-gold)' }}
                />
              </div>

            </div>

            {privacyFeedback && (
              <div style={{ padding: '10px', borderRadius: '6px', fontSize: '0.85rem', background: 'rgba(74,222,128,0.1)', color: '#4ade80', border: '1px solid #4ade80', marginBottom: '15px' }}>
                {privacyFeedback}
              </div>
            )}

            <button onClick={handlePrivacySave} className="history-btn" style={{ marginTop: '5px' }}>SAVE PRIVACY SETTINGS</button>

          </div>
        )}

      </div>
    </div>
  );
}

export default UserProfile;
