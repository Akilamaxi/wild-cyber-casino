import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';

function CyberChat({ isOpen, onClose, currentUser, onOpenLogin }) {
  const [messages, setMessages] = useState([]);
  const [inputVal, setInputVal] = useState('');
  const socketRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    // Connect to WebSocket server relative URL to map correctly under Cloud Run / local dev proxy
    socketRef.current = io();

    socketRef.current.on('chat_message', (msg) => {
      setMessages((prev) => [...prev, msg].slice(-100)); // Cap logs to last 100 messages
    });

    // Populate some welcome messages on load
    setMessages([
      { username: 'CyberBot', email: 'system@bot.casino', message: 'Welcome to the Wild Cyber Casino live chat! 🎰 Enjoy the game and play responsibly.', role: 'ADMIN', timestamp: new Date().toISOString() }
    ]);

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  useEffect(() => {
    // Auto scroll to latest messages
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!inputVal.trim()) return;

    if (!currentUser) {
      onOpenLogin();
      return;
    }

    const payload = {
      username: currentUser.username,
      email: currentUser.email,
      message: inputVal.trim(),
      role: currentUser.role || 'USER'
    };

    socketRef.current.emit('send_chat_message', payload);
    setInputVal('');
  };

  // Generate dynamic seed color for username circle
  const getAvatarColor = (name) => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = Math.abs(hash % 360);
    return `hsl(${h}, 70%, 55%)`;
  };

  if (!isOpen) return null;

  return (
    <div className="cyber-chat-drawer">
      {/* Backdrop overlay */}
      <div className="chat-backdrop" onClick={onClose}></div>

      {/* Drawer Body */}
      <div className="chat-content-panel">
        <div className="chat-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1.2rem' }}>💬</span>
            <h3 style={{ margin: '0', color: '#fff', letterSpacing: '1px' }}>CYBER CHAT</h3>
            <span className="live-status-dot"></span>
          </div>
          <button className="chat-close-btn" onClick={onClose}>✕</button>
        </div>

        {/* Messages List Area */}
        <div className="chat-messages-container">
          {messages.map((msg, index) => {
            const isAdmin = msg.role === 'ADMIN';
            const initials = msg.username.substring(0, 2).toUpperCase();
            const avatarBg = getAvatarColor(msg.username);

            return (
              <div key={index} className={`chat-message-row ${isAdmin ? 'admin-row' : ''}`}>
                {/* User Avatar Badge */}
                <div 
                  className="chat-avatar-circle"
                  style={{ background: isAdmin ? 'linear-gradient(135deg, #ff0055, #7a00ff)' : avatarBg }}
                >
                  {initials}
                </div>

                <div style={{ flex: '1' }}>
                  {/* Meta */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                    <span className={`chat-username ${isAdmin ? 'admin-name' : ''}`}>
                      {msg.username}
                    </span>
                    {isAdmin && <span className="chat-admin-tag">ADMIN 🛡️</span>}
                    <span style={{ color: '#555', fontSize: '0.7rem' }}>
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  {/* Message Bubble */}
                  <div className={`chat-bubble ${isAdmin ? 'admin-bubble' : ''}`}>
                    {msg.message}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={scrollRef} />
        </div>

        {/* Input area */}
        <form onSubmit={handleSendMessage} className="chat-input-form">
          {currentUser ? (
            <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
              <input 
                type="text" 
                placeholder="Type a message..." 
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                maxLength="200"
                className="chat-input-field"
                required
              />
              <button type="submit" className="chat-send-btn">
                SEND
              </button>
            </div>
          ) : (
            <div className="chat-locked-overlay">
              <button type="button" onClick={onOpenLogin} className="chat-unlock-login-btn">
                🔒 LOG IN TO PARTICIPATE
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

export default CyberChat;
