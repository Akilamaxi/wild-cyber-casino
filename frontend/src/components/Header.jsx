import React from 'react';

function Header({ currentUser, onLogout, onOpenLogin, onOpenSignup, onViewChange }) {
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
