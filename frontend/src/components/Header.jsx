import React from 'react';

function Header({ currentUser, onLogout, onOpenLogin, onOpenSignup, onViewChange, onChatToggle }) {
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
            justifyContent: 'center',
            background: 'rgba(0, 255, 102, 0.08)',
            border: '1px solid var(--neon-green)',
            borderRadius: '50%',
            width: '38px',
            height: '38px',
            cursor: 'pointer',
            boxShadow: '0 0 10px rgba(0, 255, 102, 0.15)',
            transition: 'all 0.2s ease',
            fontSize: '1.2rem',
            marginRight: '15px',
            flexShrink: 0
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(0, 255, 102, 0.15)';
            e.currentTarget.style.boxShadow = '0 0 15px rgba(0, 255, 102, 0.3)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(0, 255, 102, 0.08)';
            e.currentTarget.style.boxShadow = '0 0 10px rgba(0, 255, 102, 0.15)';
          }}
        >
          💬
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
            
            {/* User tag */}
            <div className="header-username-badge">
              <span className="user-icon-visual">👤</span>
              <span className="username-text">{currentUser.username}</span>
            </div>

            <button className="header-logout-btn" onClick={onLogout}>
              LOGOUT
            </button>
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
