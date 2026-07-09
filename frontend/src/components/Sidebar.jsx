import React from 'react';

function Sidebar({ currentView, onViewChange, currentUser, onOpenLogin, isCollapsed, onToggleCollapse }) {
  const menuItems = [
    { id: 'landing', label: 'Casino Lobby', icon: '🎰', playable: true },
    { id: 'slots', label: 'Slots', icon: '🍒', playable: true },
    { id: 'game', label: 'Spin Wheel', icon: '🎡', playable: true },
    { id: 'lottery', label: 'Cyber Lottery', icon: '🎟️', playable: true },
    { id: 'blackjack', label: 'Blackjack', icon: '🃏', playable: false },
    { id: 'roulette', label: 'Table Games', icon: '🎲', playable: false },
    { id: 'leaderboard', label: 'Leaderboard', icon: '🏆', playable: true },
    {id: 'wallet', label: 'Wallet Dashboard', icon: '💳', playable: true },
    {id: 'profile', label: 'User Profile', icon: '👤', playable: true },
    {id: 'vip', label: 'VIP Rewards', icon: '👑', playable: false }
  ];

  const handleItemClick = (item) => {
    if ((item.id === 'wallet' || item.id === 'profile') && !currentUser) {
      onOpenLogin();
      return;
    }
    if (item.playable) {
      onViewChange(item.id);
    } else {
      alert(`${item.label} tables are currently offline. Check out Slots or Spin Wheel!`);
    }
  };

  return (
    <aside className={`casino-sidebar ${isCollapsed ? 'collapsed' : ''}`}>
      {/* Toggle menu button */}
      <button className="sidebar-toggle-btn" onClick={onToggleCollapse}>
        {isCollapsed ? '≫ SHOW' : '≪ HIDE MENU'}
      </button>

      {/* Navigation menu items */}
      <ul className="sidebar-menu-list">
        {menuItems.map((item) => {
          const isActive = currentView === item.id;
          return (
            <li key={item.id} className="sidebar-menu-item">
              <button 
                className={`sidebar-menu-btn ${isActive ? 'active' : ''}`}
                onClick={() => handleItemClick(item)}
              >
                <span className="sidebar-item-icon">{item.icon}</span>
                {!isCollapsed && <span className="sidebar-item-label">{item.label}</span>}
                {!isCollapsed && !item.playable && <span className="sidebar-lock-badge">🔒</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

export default Sidebar;
