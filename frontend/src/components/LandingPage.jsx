import React, { useState, useEffect } from 'react';

function LandingPage({ currentUser, onPlayGame, onOpenLogin }) {
  const [jackpot, setJackpot] = useState(1452987.20);
  const [selectedMockGame, setSelectedMockGame] = useState(null); // For custom coming soon popups

  // Increment jackpot count continuously for visual appeal
  useEffect(() => {
    const interval = setInterval(() => {
      setJackpot(prev => prev + parseFloat((Math.random() * 2.5).toFixed(2)));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleCardClick = (game) => {
    if (game.playable) {
      if (currentUser) {
        onPlayGame(game.id);
      } else {
        onOpenLogin();
      }
    } else {
      setSelectedMockGame(game);
    }
  };

  const categories = [
    {
      id: 'featured',
      title: 'Featured Games',
      icon: '✨',
      games: [
        { id: 'spinwheel', title: 'NEON SPIN WHEEL', tag: 'WILD', badge: 'LIVE', desc: 'Spin our neon wheel for secure backend verified payouts!', emoji: '🎡', color: '#00ff66', playable: true },
        { id: 'slots', title: 'CYBER SLOTS 777', tag: 'HOT', badge: 'LIVE', desc: 'Roll 3 cyberpunk reels with Wild multiplier payouts.', emoji: '🎰', color: '#ffcc00', playable: true },
        { id: 'lottery', title: 'CYBER LOTTERY', tag: 'NEW', badge: 'LIVE', desc: 'Pick 6 numbers from 1 to 49 and claim 10,000x jackpots!', emoji: '🎟️', color: '#00b0ff', playable: true }
      ]
    },
    {
      id: 'new',
      title: 'New Releases',
      icon: '👁️',
      games: [
        { id: 'caishen', title: 'CAISHEN INFINITY', tag: 'NEW', desc: 'East-Asian slot with infinite paylines and gold dragons.', emoji: '🐉', color: '#ff0055', playable: false },
        { id: 'thor', title: 'THOR HAMMER STRIKE', tag: 'NEW', desc: 'Scandinavian god slot with lightning multipliers.', emoji: '⚡', color: '#00b0ff', playable: false },
        { id: 'gemclusters', title: 'GEM CLUSTERS', tag: 'WIN BIG', desc: 'Cascade match neon gems for cluster bonuses.', emoji: '💎', color: '#b500ff', playable: false },
        { id: 'charming', title: 'CHARMING COINS', tag: 'NEW', desc: 'Unlock gold coins to hit the coin link jackpot.', emoji: '🪙', color: '#00e676', playable: false }
      ]
    },
    {
      id: 'popular',
      title: 'Popular Games',
      icon: '🔥',
      games: [
        { id: 'spinwheel', title: 'NEON SPIN WHEEL', tag: 'HOT', badge: 'LIVE', desc: 'Spin our neon wheel for secure backend verified payouts!', emoji: '🎡', color: '#00ff66', playable: true },
        { id: 'slots', title: 'CYBER SLOTS 777', tag: 'HOT', badge: 'LIVE', desc: 'Roll 3 cyberpunk reels with Wild multiplier payouts.', emoji: '🎰', color: '#ffcc00', playable: true },
        { id: 'lottery', title: 'CYBER LOTTERY', tag: 'NEW', badge: 'LIVE', desc: 'Pick 6 numbers from 1 to 49 and claim 10,000x jackpots!', emoji: '🎟️', color: '#00b0ff', playable: true },
        { id: 'blackjack', title: 'RETRO BLACKJACK', tag: 'EARLY', desc: 'Provably fair smart contract blackjack tables.', emoji: '🃏', color: '#00e676', playable: false },
        { id: 'roulette', title: 'VOLT ROULETTE', tag: 'HOT', desc: 'Double-zero digital wheel game with volt multipliers.', emoji: '🎲', color: '#ffea00', playable: false },
        { id: 'bison', title: 'BISON HORIZON', tag: 'HOT', desc: 'Stampeding bison symbols trigger wild gold multipliers.', emoji: '🦬', color: '#d50000', playable: false }
      ]
    },
    {
      id: 'exclusives',
      title: 'Lobby Exclusives',
      icon: '👑',
      games: [
        { id: 'multiblackjack', title: 'MULTI BLACKJACK', tag: 'EXCLUSIVE', desc: 'Play up to 3 hands simultaneously against the dealer.', emoji: '♠️', color: '#d500f9', playable: false },
        { id: 'cryptojackpot', title: 'CRYPTO JACKPOTS', tag: 'EARLY', desc: 'Progressive jackpot linked to block validation ticks.', emoji: '₿', color: '#ff9100', playable: false },
        { id: 'olympus', title: 'OLYMPUS GOLD', tag: 'EARLY', desc: 'Zeus lightning triggers scatter symbols and free spins.', emoji: '🏛️', color: '#00e5ff', playable: false }
      ]
    }
  ];

  return (
    <div className="landing-page-container">
      {/* Dynamic Jackpot Banner */}
      <div className="lobby-jackpot-banner">
        <div className="jackpot-glow-effect"></div>
        <div className="jackpot-wrapper-inner">
          <span className="jackpot-badge-neon">🔥 ACTIVE GRAND JACKPOT 🔥</span>
          <span className="jackpot-value">
            ${jackpot.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span className="jackpot-info">Play any slots or spin games to trigger the random payout drop!</span>
        </div>
      </div>

      {/* Categories Content List */}
      {categories.map((category) => (
        <section key={category.id} className="lobby-category-section">
          <div className="category-header-wrap">
            <h3 className="category-row-title">
              <span className="category-title-icon">{category.icon}</span>
              {category.title}
              <span className="category-count-badge">({category.games.length})</span>
            </h3>
            <span className="category-view-all-link">View all ≫</span>
          </div>

          {/* Horizontal game cards deck */}
          <div className="lobby-games-shelf">
            {category.games.map((game, i) => (
              <div 
                key={`${game.id}-${i}`}
                className={`lobby-game-card ${game.playable ? 'playable' : 'locked'}`}
                onClick={() => handleCardClick(game)}
                style={{ '--card-theme-color': game.color }}
              >
                {/* Ribbon Tag */}
                <div className={`card-ribbon-tag ${game.playable ? 'live' : 'mock'}`}>
                  {game.tag}
                </div>

                <div className="card-visual-header" style={{ color: game.color, backgroundColor: game.color + '12' }}>
                  <span className="card-emoji-icon">{game.emoji}</span>
                </div>

                <div className="card-body-details">
                  <h4 className="card-game-title">{game.title}</h4>
                  <p className="card-game-desc">{game.desc}</p>
                  
                  {game.playable ? (
                    <span className="card-play-status-btn">PLAY NOW 🎮</span>
                  ) : (
                    <span className="card-play-status-btn disabled">LOCKED 🔒</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      {/* Floating Chat Support Simulation */}
      <div 
        className="floating-support-widget" 
        onClick={() => alert("Cyber Chat support agent is offline. Drop a ticket inside your Wallet dashboard!")}
        title="24/7 Cyber Support"
      >
        💬
      </div>

      {/* Coming Soon custom details popup */}
      {selectedMockGame && (
        <div className="mock-details-backdrop" onClick={() => setSelectedMockGame(null)}>
          <div className="mock-details-content" onClick={(e) => e.stopPropagation()}>
            <button className="mock-close-btn" onClick={() => setSelectedMockGame(null)}>✕</button>
            <div className="mock-visual-header" style={{ color: selectedMockGame.color }}>
              <span className="mock-emoji">{selectedMockGame.emoji}</span>
            </div>
            <h3>{selectedMockGame.title}</h3>
            <div className="mock-coming-soon-badge">🔒 COMING SOON</div>
            <p className="mock-description">{selectedMockGame.desc}</p>
            <div className="mock-info-rows">
              <div className="info-row">
                <span>RTP:</span>
                <span className="highlight-green">98.4% (Verified)</span>
              </div>
              <div className="info-row">
                <span>Game Type:</span>
                <span>Provably Fair RNG</span>
              </div>
              <div className="info-row">
                <span>Bet Range:</span>
                <span>$2 - $500</span>
              </div>
            </div>
            <button className="mock-notify-btn" onClick={() => { alert("Notified! We will alert you when tables open."); setSelectedMockGame(null); }}>
              NOTIFY ME ON RELEASE 🔔
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default LandingPage;
