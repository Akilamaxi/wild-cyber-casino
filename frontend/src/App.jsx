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
import { apiFetch } from './config';
import CyberDiceGame from './components/CyberDiceGame';
import CyberCrashGame from './components/CyberCrashGame';
import NeonPlinko from './components/NeonPlinko';
import AffiliateDashboard from './components/AffiliateDashboard';

function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [currentView, setCurrentView] = useState('landing'); // 'landing' | 'game' | 'slots' | 'lottery' | 'leaderboard' | 'wallet'
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [authTab, setAuthTab] = useState('login');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);

  // Load user session from LocalStorage on mount
  useEffect(() => {
    // Save referral code if present in URL
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref) {
      sessionStorage.setItem('referral_code', ref);
      console.log('[AFFILIATE] Saved referral code from URL:', ref);
    }

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
    setCurrentView('landing');
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('casino_session');
    apiFetch('/api/v1/auth/logout', { method: 'POST' }).catch(() => {});
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
    } else if (gameId === 'crash') {
      setCurrentView('crash');
    } else if (gameId === 'dice') {
      setCurrentView('dice');
    } else if (gameId === 'plinko') {
      setCurrentView('plinko');
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
          onChatToggle={() => setIsChatOpen(prev => !prev)}
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
          {currentView === 'crash' && currentUser && (
            <CyberCrashGame 
              currentUser={currentUser}
              onBalanceUpdate={handleBalanceUpdate}
            />
          )}
          {currentView === 'plinko' && currentUser && (
            <NeonPlinko 
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
          {currentView === 'affiliate' && currentUser && (
            <AffiliateDashboard 
              userSession={currentUser}
              onWalletUpdate={handleBalanceUpdate}
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
    </div>
  );
}

export default App;
