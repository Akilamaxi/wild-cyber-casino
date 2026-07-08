import React, { useState, useEffect, useRef } from 'react';

const PRIZES = [
  { text: '10% CASHBACK', color: '#ff0055', textColor: '#ffffff' },
  { text: 'TRY AGAIN', color: '#111122', textColor: '#ffffff' },
  { text: 'FREE $10', color: '#00ffcc', textColor: '#000000' },
  { text: 'NO LUCK', color: '#1a1a30', textColor: '#ffffff' },
  { text: 'JACKPOT x5', color: '#ffcc00', textColor: '#000000' },
  { text: '20% BONUS', color: '#b500ff', textColor: '#ffffff' }
];

function SpinWheelGame({ currentUser, onBalanceUpdate }) {
  const canvasRef = useRef(null);
  const [isSpinning, setIsSpinning] = useState(false);
  const [resultText, setResultText] = useState('');
  
  // Custom animation variables
  const currentRotation = useRef(0);

  // Draw the Canvas Wheel on Mount
  useEffect(() => {
    drawWheel(0);
  }, []);

  const drawWheel = (currentAngle) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    const center = size / 2;
    const radius = center - 5;
    const numSectors = PRIZES.length;
    const sectorAngle = (2 * Math.PI) / numSectors;

    ctx.clearRect(0, 0, size, size);

    // Save context to rotate the entire wheel
    ctx.save();
    ctx.translate(center, center);
    ctx.rotate(currentAngle);
    ctx.translate(-center, -center);

    for (let i = 0; i < numSectors; i++) {
      const startAngle = i * sectorAngle;
      const endAngle = startAngle + sectorAngle;

      // Draw Sector Pie Slice
      ctx.beginPath();
      ctx.moveTo(center, center);
      ctx.arc(center, center, radius, startAngle, endAngle);
      ctx.fillStyle = PRIZES[i].color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.stroke();

      // Draw Text inside sector
      ctx.save();
      ctx.translate(center, center);
      // Rotate text to center of slice
      ctx.rotate(startAngle + sectorAngle / 2);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = PRIZES[i].textColor;
      ctx.font = 'bold 11px Orbitron, sans-serif';
      // Offset text from center out toward circumference
      ctx.fillText(PRIZES[i].text, radius - 15, 0);
      ctx.restore();
    }

    // Draw inner central hub
    ctx.beginPath();
    ctx.arc(center, center, 30, 0, 2 * Math.PI);
    ctx.fillStyle = '#050510';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#ffcc00';
    ctx.stroke();

    ctx.restore();
  };

  const startSpin = async () => {
    if (isSpinning) return;
    if (!currentUser) return;
    
    const SPIN_COST = 10;
    if (currentUser.balance < SPIN_COST) {
      alert("Insufficient funds! Deposit cash inside your Wallet dashboard first.");
      return;
    }

    setIsSpinning(true);
    setResultText('');
    
    // Optimistically deduct cost client-side for dynamic feel
    onBalanceUpdate(currentUser.balance - SPIN_COST);

    try {
      // 1. Fetch result securely from backend
      const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:5000' : '';
      const response = await fetch(`${API_BASE}/api/spin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: currentUser.email })
      });
      
      const data = await response.json();

      if (!response.ok || !data.success) {
        // Revert balance and show error
        onBalanceUpdate(currentUser.balance);
        alert(data.error || 'Server Error!');
        setIsSpinning(false);
        return;
      }

      const targetIndex = data.winningIndex;
      const prizeString = data.prizeText;
      const finalBalance = data.newBalance;

      // 2. Animate the wheel to stop exactly on targetIndex at the TOP ticker pointer
      const numSectors = PRIZES.length;
      const sectorAngle = 360 / numSectors;
      
      // Calculate where the center of the winning sector is
      const targetSectorCenterAngle = (targetIndex * sectorAngle) + (sectorAngle / 2);
      
      // To bring target angle to the top pointer (270 degrees), the wheel must rotate:
      const finalRotationDegrees = (270 - targetSectorCenterAngle + 360) % 360;
      
      // Get the current rotation in degrees
      const startRotationDegrees = (currentRotation.current * 180) / Math.PI;
      
      // Find the difference between the final rotation degrees and current rotation degrees
      const diffDegrees = (finalRotationDegrees - (startRotationDegrees % 360) + 360) % 360;
      
      // Add 5 full spins (1800 degrees) for cinematic effect
      const totalRotationDegrees = 1800 + diffDegrees;

      let startTime = null;
      const duration = 5000; // 5 seconds spin animation
      const startRotation = currentRotation.current;

      const animateWheel = (timestamp) => {
        if (!startTime) startTime = timestamp;
        const elapsed = timestamp - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Cubic ease-out deceleration curve
        const easeOut = 1 - Math.pow(1 - progress, 3);
        const currentAngle = startRotation + (totalRotationDegrees * (Math.PI / 180)) * easeOut;

        drawWheel(currentAngle);

        if (progress < 1) {
          requestAnimationFrame(animateWheel);
        } else {
          // Animation Complete
          currentRotation.current = currentAngle;
          setIsSpinning(false);
          setResultText(`🎰 WON: ${prizeString} 🎰`);
          // Sync with the actual final server balance
          onBalanceUpdate(finalBalance);
        }
      };

      requestAnimationFrame(animateWheel);

    } catch (error) {
      console.error("Connection failed:", error);
      alert("Could not connect to backend server. Make sure it's running!");
      onBalanceUpdate(currentUser.balance); // Revert balance
      setIsSpinning(false);
    }
  };

  return (
    <div className="game-view-wrapper">
      <div className="casino-container">
        <h1>NEON SPIN WHEEL</h1>
        <div className="subtitle">100% SECURE BACKEND VERIFIED • COST: $10/SPIN</div>

        <div className="wheel-outer-wrapper">
          <div className="ticker"></div>
          <canvas 
            ref={canvasRef} 
            width={300} 
            height={300} 
            className="wheel-canvas"
          />
        </div>

        <button 
          className="spin-button" 
          onClick={startSpin} 
          disabled={isSpinning}
        >
          {isSpinning ? 'SPINNING...' : 'SPIN NOW'}
        </button>

        {resultText && <div className="result-popup">{resultText}</div>}
      </div>
    </div>
  );
}

export default SpinWheelGame;
