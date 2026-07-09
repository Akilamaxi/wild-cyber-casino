import React, { useState, useRef, useEffect } from 'react';

function Header({ currentUser, onLogout, onOpenLogin, onOpenSignup, onViewChange, onChatToggle }) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="casino-header-top">
      {/* Brand logo */}
      <div className="header-logo" onClick={() => onViewChange('landing')}>
        <div className="logo-text-wrapper">
          <span className="logo-text-bold">WILD</span>
          <span className="logo-text-neon">CYBER</span>
        </div>
        <span className="logo-icon-spin">🎰</span>
      </div>

      {/* Main navigation categories */}
      <div className="header-categories-nav">
        <span className="nav-item active" onClick={() => onViewChange('landing')}>CASINO</span>
        <span className="nav-item" onClick={() => alert('Live dealer streaming tables are offline right now.')}>LIVE CASINO</span>
        <span className="nav-item" onClick={() => onViewChange('landing')}>VIP REWARDS</span>
        <span className="nav-item" onClick={() => alert('Promotional deposit bonuses are active inside your wallet!')}>PROMOS</span>
      </div>

      {/* Auth state triggers */}
      <div className="header-actions">
        {/* Cyber Chat Toggle Badge */}
        <div 
          className="header-chat-badge" 
          onClick={onChatToggle}
          title="Open Chat"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'rgba(0, 255, 102, 0.05)',
            border: '1px solid rgba(0, 255, 102, 0.2)',
            padding: '8px 16px',
            borderRadius: '20px',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            color: '#fff',
            fontFamily: 'Orbitron, sans-serif',
            fontSize: '11px',
            fontWeight: '900',
            letterSpacing: '1.5px',
            marginRight: '15px',
            flexShrink: 0
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(0, 255, 102, 0.15)';
            e.currentTarget.style.borderColor = 'var(--neon-green)';
            e.currentTarget.style.boxShadow = '0 0 15px rgba(0, 255, 102, 0.3)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(0, 255, 102, 0.05)';
            e.currentTarget.style.borderColor = 'rgba(0, 255, 102, 0.2)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--neon-green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 3px var(--neon-green))' }}>
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <span>CHAT</span>
        </div>

        {currentUser ? (
          <div className="header-user-badge-group">
            {/* Clickable Wallet */}
            <div 
              className="header-wallet-badge" 
              onClick={() => onViewChange('wallet')}
              title="View wallet details"
            >
              <span className="wallet-icon-visual">💳</span>
              <span className="wallet-value-text">${currentUser.balance.toLocaleString()}</span>
            </div>
            
            {/* User Dropdown wrapper */}
            <div style={{ position: 'relative' }} ref={dropdownRef}>
              <div 
                className="header-username-badge"
                onClick={() => setIsDropdownOpen(prev => !prev)}
                style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', gap: '8px', alignItems: 'center' }}
              >
                <span className="user-icon-visual">👤</span>
                <span className="username-text" style={{ fontWeight: 'bold' }}>{currentUser.username}</span>
                <span style={{ fontSize: '9px', opacity: 0.6, transform: isDropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</span>
              </div>

              {isDropdownOpen && (
                <div style={{
                  position: 'absolute',
                  top: 'calc(100% + 8px)',
                  right: 0,
                  background: 'rgba(10, 13, 16, 0.95)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '12px',
                  padding: '6px 0',
                  minWidth: '160px',
                  boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
                  zIndex: 200,
                  display: 'flex',
                  flexDirection: 'column',
                  backdropFilter: 'blur(10px)'
                }}>
                  <button 
                    onClick={() => {
                      onViewChange('profile');
                      setIsDropdownOpen(false);
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#8ba093',
                      padding: '10px 16px',
                      textAlign: 'left',
                      cursor: 'pointer',
                      fontFamily: 'Outfit, sans-serif',
                      fontSize: '13px',
                      fontWeight: '600',
                      width: '100%',
                      transition: 'all 0.2s',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = '#8ba093'; e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span>👤</span> View Profile
                  </button>
                  <button 
                    onClick={() => {
                      onViewChange('wallet');
                      setIsDropdownOpen(false);
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#8ba093',
                      padding: '10px 16px',
                      textAlign: 'left',
                      cursor: 'pointer',
                      fontFamily: 'Outfit, sans-serif',
                      fontSize: '13px',
                      fontWeight: '600',
                      width: '100%',
                      transition: 'all 0.2s',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = '#8ba093'; e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span>💳</span> Wallet Panel
                  </button>
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', margin: '4px 0' }}></div>
                  <button 
                    onClick={() => {
                      onLogout();
                      setIsDropdownOpen(false);
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#ff0055',
                      padding: '10px 16px',
                      textAlign: 'left',
                      cursor: 'pointer',
                      fontFamily: 'Outfit, sans-serif',
                      fontSize: '13px',
                      fontWeight: 'bold',
                      width: '100%',
                      transition: 'all 0.2s',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,0,85,0.08)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span>🚪</span> Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="header-auth-buttons">
            <button className="header-login-btn" onClick={onOpenLogin}>
              LOGIN
            </button>
            <button className="header-join-btn" onClick={onOpenSignup}>
              JOIN
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

export default Header;
