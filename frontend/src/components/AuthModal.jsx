import React, { useState } from 'react';

function AuthModal({ isOpen, onClose, initialTab, onAuthSuccess }) {
  const [activeTab, setActiveTab] = useState(initialTab || 'login'); // 'login' or 'register'
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [isRefCodeFromUrl, setIsRefCodeFromUrl] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  React.useEffect(() => {
    if (activeTab === 'register') {
      const code = sessionStorage.getItem('referral_code');
      if (code) {
        setReferralCode(code);
        setIsRefCodeFromUrl(true);
      }
    }
  }, [activeTab]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setIsLoading(true);

    const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:5000' : '';
    const url = activeTab === 'login' 
      ? `${API_BASE}/api/auth/login` 
      : `${API_BASE}/api/auth/register`;
      
    let fingerprint = localStorage.getItem('casino_device_fingerprint');
    if (!fingerprint) {
      fingerprint = 'FP-' + Math.random().toString(36).substring(2, 15).toUpperCase();
      localStorage.setItem('casino_device_fingerprint', fingerprint);
    }

    const payload = activeTab === 'login' 
      ? { email, password, deviceFingerprint: fingerprint } 
      : { username, email, password, referralCode, deviceFingerprint: fingerprint };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const data = await response.json();
      
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Authentication failed. Please check inputs.');
      }

      // Success
      onAuthSuccess(data.user, data.token);
      onClose();
    } catch (err) {
      console.error('Auth Error:', err);
      setErrorMsg(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const switchTab = (tab) => {
    setActiveTab(tab);
    setErrorMsg('');
    setUsername('');
    setEmail('');
    setPassword('');
  };

  return (
    <div className="auth-modal-backdrop" onClick={onClose}>
      <div className="auth-modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="auth-modal-close" onClick={onClose}>✕</button>
        
        {/* Tab Headers */}
        <div className="auth-modal-tabs">
          <button 
            className={`auth-tab-btn ${activeTab === 'login' ? 'active' : ''}`}
            onClick={() => switchTab('login')}
          >
            SIGN IN
          </button>
          <button 
            className={`auth-tab-btn ${activeTab === 'register' ? 'active' : ''}`}
            onClick={() => switchTab('register')}
          >
            REGISTER
          </button>
        </div>

        {/* Error Bar */}
        {errorMsg && <div className="auth-error-banner">⚠️ {errorMsg}</div>}

        {/* Form */}
        <form onSubmit={handleSubmit} className="auth-form">
          {activeTab === 'register' && (
            <div className="form-group">
              <label htmlFor="username">Username</label>
              <input 
                type="text" 
                id="username" 
                placeholder="CyberPlayer77" 
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
          )}

          <div className="form-group">
            <label htmlFor="email">Email Address</label>
            <input 
              type="email" 
              id="email" 
              placeholder="player@neon.com" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input 
              type="password" 
              id="password" 
              placeholder="••••••••" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {activeTab === 'register' && (
            <div className="form-group">
              <label htmlFor="referralCode">
                Referral Code
                <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 'normal', fontSize: '11px', marginLeft: '6px' }}>(Optional)</span>
              </label>
              {isRefCodeFromUrl && referralCode && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: 'rgba(0, 255, 102, 0.06)',
                  border: '1px solid rgba(0, 255, 102, 0.25)',
                  borderRadius: '6px',
                  padding: '6px 10px',
                  marginBottom: '6px',
                  fontSize: '11px',
                  color: '#00ff66',
                }}>
                  <span>🔗</span>
                  <span style={{ flex: 1 }}>Referral link applied: <strong>{referralCode}</strong></span>
                  <button
                    type="button"
                    onClick={() => { setReferralCode(''); setIsRefCodeFromUrl(false); sessionStorage.removeItem('referral_code'); }}
                    style={{ background: 'none', border: 'none', color: '#ff4477', cursor: 'pointer', fontSize: '14px', padding: '0 2px', lineHeight: 1 }}
                    title="Remove referral code"
                  >✕</button>
                </div>
              )}
              <input
                type="text"
                id="referralCode"
                placeholder="REF-XXXXXX"
                value={referralCode}
                onChange={(e) => { setReferralCode(e.target.value.toUpperCase()); setIsRefCodeFromUrl(false); }}
              />
            </div>
          )}

          {activeTab === 'register' && (
            <div className="form-checkbox-group">
              <input type="checkbox" id="terms" required defaultChecked />
              <label htmlFor="terms">I verify that I am over 18 and accept all virtual rules.</label>
            </div>
          )}

          <button type="submit" className="auth-submit-btn" disabled={isLoading}>
            {isLoading ? 'VERIFYING...' : activeTab === 'login' ? 'ENTER CASINO 🚀' : 'CREATE ACCOUNT ✨'}
          </button>
        </form>

        <div className="auth-modal-footer">
          {activeTab === 'login' ? (
            <p>Don't have an account? <span onClick={() => switchTab('register')} className="footer-switch-link">Register here</span></p>
          ) : (
            <p>Already registered? <span onClick={() => switchTab('login')} className="footer-switch-link">Sign In here</span></p>
          )}
        </div>
      </div>
    </div>
  );
}

export default AuthModal;
