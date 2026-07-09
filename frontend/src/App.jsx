import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import LandingPage from './components/LandingPage';
import SpinWheelGame from './components/SpinWheelGame';
import AuthModal from './components/AuthModal';
import Leaderboard from './components/Leaderboard';
import WalletPanel from './components/WalletPanel';
import CyberSlotsGame from './components/CyberSlotsGame';
import LotteryGame from './components/LotteryGame';
import UserProfile from './components/UserProfile';
import CyberChat from './components/CyberChat';
import CyberDiceGame from './components/CyberDiceGame';

function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [currentView, setCurrentView] = useState('landing'); // 'landing' | 'game' | 'slots' | 'lottery' | 'leaderboard' | 'wallet'
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [authTab, setAuthTab] = useState('login');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);

  // Load user session from LocalStorage on mount
  useEffect(() => {
    const savedUser = localStorage.getItem('casino_session');
    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        setCurrentUser(parsed);
      } catch (err) {
        localStorage.removeItem('casino_session');
      }
    }
  }, []);

  const handleAuthSuccess = (user) => {
    setCurrentUser(user);
    localStorage.setItem('casino_session', JSON.stringify(user));
    setCurrentView('landing'); // Go to landing first
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('casino_session');
    setCurrentView('landing');
  };

  const handleBalanceUpdate = (newBalance) => {
    if (!currentUser) return;
    const updatedUser = { ...currentUser, balance: newBalance };
    setCurrentUser(updatedUser);
    localStorage.setItem('casino_session', JSON.stringify(updatedUser));
  };

  const openLogin = () => {
    setAuthTab('login');
    setIsAuthOpen(true);
  };

  const openSignup = () => {
    setAuthTab('register');
    setIsAuthOpen(true);
  };

  const handlePlayGame = (gameId) => {
    if (gameId === 'slots') {
      setCurrentView('slots');
    } else if (gameId === 'spinwheel') {
      setCurrentView('game');
    } else if (gameId === 'lottery') {
      setCurrentView('lottery');
    }
  };

  return (
    <div className="app-main-layout-container">
      {/* Sidebar navigation */}
      <Sidebar 
        currentView={currentView}
        onViewChange={setCurrentView}
        currentUser={currentUser}
        onOpenLogin={openLogin}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
      />

      {/* Main workspace (Header + Viewport) */}
      <div className={`app-main-workspace-container ${isSidebarCollapsed ? 'expanded-width' : ''}`}>
        <Header 
          currentUser={currentUser}
          onLogout={handleLogout}
          onOpenLogin={openLogin}
          onOpenSignup={openSignup}
          onViewChange={setCurrentView}
        />

        <main className="casino-app-content">
          {currentView === 'landing' && (
            <LandingPage 
              currentUser={currentUser}
              onPlayGame={handlePlayGame}
              onOpenLogin={openLogin}
            />
          )}
          {currentView === 'game' && (
            <SpinWheelGame 
              currentUser={currentUser}
              onBalanceUpdate={handleBalanceUpdate}
            />
          )}
          {currentView === 'slots' && currentUser && (
            <CyberSlotsGame 
              currentUser={currentUser}
              onBalanceUpdate={handleBalanceUpdate}
            />
          )}
          {currentView === 'lottery' && currentUser && (
            <LotteryGame 
              currentUser={currentUser}
              onBalanceUpdate={handleBalanceUpdate}
            />
          )}
          {currentView === 'dice' && currentUser && (
            <CyberDiceGame 
              currentUser={currentUser}
              onBalanceUpdate={handleBalanceUpdate}
            />
          )}
          {currentView === 'leaderboard' && (
            <Leaderboard 
              currentUser={currentUser}
            />
          )}
          {currentView === 'wallet' && currentUser && (
            <WalletPanel 
              currentUser={currentUser}
              onBalanceUpdate={handleBalanceUpdate}
            />
          )}
          {currentView === 'profile' && currentUser && (
            <UserProfile 
              currentUser={currentUser}
              onBalanceUpdate={handleBalanceUpdate}
            />
          )}
        </main>
      </div>

      {/* Auth overlay modal */}
      <AuthModal 
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        initialTab={authTab}
        onAuthSuccess={handleAuthSuccess}
      />

      {/* Cyber Chat Drawer Widget */}
      <CyberChat 
        isOpen={isChatOpen} 
        onClose={() => setIsChatOpen(false)} 
        currentUser={currentUser} 
        onOpenLogin={openLogin} 
      />

      {/* Floating Chat Bubble Toggle Button */}
      {!isChatOpen && (
        <button 
          className="floating-support-widget" 
          onClick={() => setIsChatOpen(true)}
          title="Open Cyber Chat"
          style={{ border: 'none' }}
        >
          💬
        </button>
      )}
    </div>
  );
}

export default App;
