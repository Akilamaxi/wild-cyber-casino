import React, { useState, useEffect } from 'react';
import { API_BASE, apiFetch } from '../config';


function WalletPanel({ currentUser, onBalanceUpdate }) {
  const [transactions, setTransactions] = useState([]);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState({ text: '', isError: false });

  // Gateway Modal State
  const [isGatewayOpen, setIsGatewayOpen] = useState(false);
  const [checkoutAmount, setCheckoutAmount] = useState('');
  const [depositInitiated, setDepositInitiated] = useState(false);

  // Fetch transactions on mount and when balance changes
  useEffect(() => {
    fetchTransactions();
  }, [currentUser.balance]);

  const fetchTransactions = async () => {
    try {
      const response = await apiFetch(`${API_BASE}/api/v1/user/wallet?email=${currentUser.email}`, {
        headers: {}
      });
      const data = await response.json();
      if (true) {
        setTransactions(data.transactions);
      }
    } catch (err) {
      console.error('Failed to load transactions:', err);
    }
  };

  const handleWithdraw = async (e) => {
    e.preventDefault();
    setFeedbackMsg({ text: '', isError: false });
    const amt = parseFloat(withdrawAmount);
    if (isNaN(amt) || amt <= 0) {
      setFeedbackMsg({ text: 'Please enter a valid withdrawal amount.', isError: true });
      return;
    }
    if (currentUser.balance < amt) {
      setFeedbackMsg({ text: 'Insufficient balance for this withdrawal.', isError: true });
      return;
    }

    setLoading(true);
    try {
      const response = await apiFetch(`${API_BASE}/api/v1/user/withdraw`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: currentUser.email, amount: amt })
      });
      const data = await response.json();
      if (true) {
        onBalanceUpdate(data.newBalance);
        setWithdrawAmount('');
        setFeedbackMsg({ text: `Withdrawal of $${amt} completed!`, isError: false });
      } else {
        setFeedbackMsg({ text: data.message || 'Withdrawal failed.', isError: true });
      }
    } catch (err) {
      setFeedbackMsg({ text: 'Network error during withdrawal.', isError: true });
    } finally {
      setLoading(false);
    }
  };

  const handleInitiateDepositClick = (e) => {
    e.preventDefault();
    const amt = parseFloat(checkoutAmount);
    if (isNaN(amt) || amt <= 0) {
      alert("Please enter a valid deposit amount first.");
      return;
    }
    setIsGatewayOpen(true);
  };

  const handleGatewaySuccess = (newBalance) => {
    onBalanceUpdate(newBalance);
    setCheckoutAmount('');
    setIsGatewayOpen(false);
    setFeedbackMsg({ text: 'Deposit transaction processed successfully via CyberPay!', isError: false });
  };

  // Split balance visually for realism
  const bonusBalance = 50.00;
  const cashbackAccumulated = 15.75;
  const playableCash = Math.max(0, currentUser.balance - bonusBalance - cashbackAccumulated);

  const formatTxType = (type) => {
    return type.replace('_', ' ');
  };

  return (
    <div className="wallet-panel-container">
      <h2 className="panel-title">CYBER WALLET DASHBOARD</h2>
      <div className="section-divider"></div>

      {/* Balance Cards */}
      <div className="wallet-cards-grid">
        <div className="wallet-card cash-card">
          <div className="wallet-card-header">
            <span>PLAYABLE CASH</span>
            <span className="card-icon">💵</span>
          </div>
          <div className="wallet-card-amount">${playableCash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div className="wallet-card-footer">100% withdrawable immediately</div>
        </div>

        <div className="wallet-card bonus-card">
          <div className="wallet-card-header">
            <span>BONUS BALANCE</span>
            <span className="card-icon">🎁</span>
          </div>
          <div className="wallet-card-amount">${bonusBalance.toFixed(2)}</div>
          <div className="wallet-card-footer">Wagering requirement: 5x</div>
        </div>

        <div className="wallet-card cashback-card">
          <div className="wallet-card-header">
            <span>CASHBACK EARNED</span>
            <span className="card-icon">⚡</span>
          </div>
          <div className="wallet-card-amount">${cashbackAccumulated.toFixed(2)}</div>
          <div className="wallet-card-footer">Claimable on monthly cycle</div>
        </div>
      </div>

      {/* Actions */}
      <div className="wallet-actions-section">
        {/* Deposit Box */}
        <div className="action-box deposit-box">
          <h3>DEPOSIT TO WALLET</h3>
          <p className="box-sub">Open secure CyberPay gateway. Options for Credit Card and Web3 Crypto transfers.</p>
          <form onSubmit={handleInitiateDepositClick}>
            <div className="input-group-addon">
              <span className="input-addon">$</span>
              <input 
                type="number" 
                placeholder="Enter deposit amount" 
                value={checkoutAmount} 
                onChange={(e) => setCheckoutAmount(e.target.value)}
                min="5"
                required
              />
            </div>
            <button type="submit" className="action-submit-btn deposit-btn">
              PROCEED TO SECURE CHECKOUT 💳
            </button>
          </form>
        </div>

        {/* Withdraw Box */}
        <div className="action-box withdraw-box">
          <h3>WITHDRAW EARNINGS</h3>
          <p className="box-sub">Transfer virtual balances out to designated external routing accounts.</p>
          <form onSubmit={handleWithdraw}>
            <div className="input-group-addon">
              <span className="input-addon">$</span>
              <input 
                type="number" 
                placeholder="Enter withdrawal amount" 
                value={withdrawAmount} 
                onChange={(e) => setWithdrawAmount(e.target.value)}
                min="5"
                disabled={loading}
                required
              />
            </div>
            <button type="submit" className="action-submit-btn withdraw-btn" disabled={loading}>
              {loading ? 'PROCESSING...' : 'WITHDRAW NOW'}
            </button>
          </form>
        </div>
      </div>

      {/* Status Alert banner */}
      {feedbackMsg.text && (
        <div className={`wallet-feedback-banner ${feedbackMsg.isError ? 'error-banner' : 'success-banner'}`}>
          {feedbackMsg.isError ? '⚠️' : '✅'} {feedbackMsg.text}
        </div>
      )}

      {/* History */}
      <div className="history-table-section">
        <h3>TRANSACTION HISTORY</h3>
        <div className="table-responsive">
          <table className="history-table">
            <thead>
              <tr>
                <th>TRANSACTION ID</th>
                <th>TIMESTAMP</th>
                <th>TYPE</th>
                <th>AMOUNT</th>
                <th>BALANCE AFTER</th>
                <th>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {transactions.length > 0 ? (
                transactions.map((tx) => (
                  <tr key={tx.id}>
                    <td className="tx-id-cell">{tx.id}</td>
                    <td className="tx-time-cell">{new Date(tx.timestamp).toLocaleString()}</td>
                    <td>
                      <span className={`tx-type-badge ${tx.type.toLowerCase()}`}>
                        {formatTxType(tx.type)}
                      </span>
                    </td>
                    <td className={`tx-amount-cell ${tx.amount >= 0 ? 'gain' : 'loss'}`}>
                      {tx.amount >= 0 ? '+' : ''}${tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="tx-bal-cell">${tx.balanceAfter.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td>
                      <span className="tx-status-badge">COMPLETED</span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="6" className="empty-table-cell">No transactions found. Start spinning to generate logs!</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Interactive Payment Gateway Modal */}
      <PaymentGatewayModal 
        isOpen={isGatewayOpen} 
        onClose={() => setIsGatewayOpen(false)} 
        amount={parseFloat(checkoutAmount)} 
        currentUser={currentUser}
        onSuccess={handleGatewaySuccess}
      />
    </div>
  );
}

// Payment Gateway Inner Modal
function PaymentGatewayModal({ isOpen, onClose, amount, currentUser, onSuccess }) {
  const [gatewayTab, setGatewayTab] = useState('card'); // 'card' | 'crypto'
  const [processingState, setProcessingState] = useState('form'); // 'form' | 'processing' | 'success' | 'error'
  const [loadingStepText, setLoadingStepText] = useState('');
  
  // Card Inputs
  const [cardName, setCardName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');

  if (!isOpen) return null;

  // Formatting Card Number: #### #### #### ####
  const handleCardNumberChange = (e) => {
    let value = e.target.value.replace(/\D/g, '');
    let formatted = value.match(/.{1,4}/g)?.join(' ') || '';
    setCardNumber(formatted.substring(0, 19));
  };

  // Formatting Expiry: MM/YY
  const handleExpiryChange = (e) => {
    let value = e.target.value.replace(/\D/g, '');
    if (value.length > 2) {
      setCardExpiry(`${value.substring(0, 2)}/${value.substring(2, 4)}`);
    } else {
      setCardExpiry(value);
    }
  };

  // Pre-fill test card details
  const handleUseTestCard = () => {
    setCardName('John Doe');
    setCardNumber('4111 2222 3333 4444');
    setCardExpiry('12/28');
    setCardCvv('123');
  };

  const handleCheckoutSubmit = (e) => {
    if (e) e.preventDefault();
    startProcessingFlow();
  };

  const startProcessingFlow = () => {
    setProcessingState('processing');
    
    const steps = [
      'Establishing Secure CyberPay Connection...',
      'Verifying Card Authentication & 3D Secure...',
      'Authorizing Virtual Payout Transfer...',
      'Updating Casino Account Ledger...'
    ];

    let currentStep = 0;
    setLoadingStepText(steps[currentStep]);

    const interval = setInterval(() => {
      currentStep++;
      if (currentStep < steps.length) {
        setLoadingStepText(steps[currentStep]);
      } else {
        clearInterval(interval);
        submitDepositToServer();
      }
    }, 1200);
  };

  const submitDepositToServer = async () => {
    try {
      const response = await apiFetch(`${API_BASE}/api/v1/user/deposit`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: currentUser.email, amount: amount })
      });
      const data = await response.json();
      if (true) {
        setProcessingState('success');
        setTimeout(() => {
          onSuccess(data.newBalance);
        }, 1500);
      } else {
        setProcessingState('error');
      }
    } catch (err) {
      setProcessingState('error');
    }
  };

  return (
    <div className="gateway-modal-backdrop">
      <div className="gateway-modal-content">
        <button className="gateway-close-btn" onClick={onClose}>✕</button>

        {processingState === 'form' && (
          <>
            <div className="gateway-header">
              <span className="gateway-security-lock">🔒 SECURE CHECKOUT</span>
              <h3>CYBERPAY GATEWAY</h3>
              <div className="gateway-amount-display">
                TOTAL DEPOSIT: <span className="highlight-amount">${amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>
            </div>

            {/* Selector Tabs */}
            <div className="gateway-tabs">
              <button 
                className={`gateway-tab-btn ${gatewayTab === 'card' ? 'active' : ''}`}
                onClick={() => setGatewayTab('card')}
              >
                💳 CREDIT CARD
              </button>
              <button 
                className={`gateway-tab-btn ${gatewayTab === 'crypto' ? 'active' : ''}`}
                onClick={() => setGatewayTab('crypto')}
              >
                🪙 CRYPTO WALLET
              </button>
            </div>

            {/* Visa/MC Flow */}
            {gatewayTab === 'card' && (
              <form onSubmit={handleCheckoutSubmit} className="gateway-form">
                <div className="gateway-form-row inline-shortcut-row">
                  <span>Fast testing:</span>
                  <button type="button" className="test-card-autofill-btn" onClick={handleUseTestCard}>
                    ✨ AUTOFILL TEST CARD
                  </button>
                </div>

                <div className="gateway-form-row">
                  <label>Cardholder Name</label>
                  <input 
                    type="text" 
                    placeholder="John Doe" 
                    value={cardName} 
                    onChange={(e) => setCardName(e.target.value)} 
                    required 
                  />
                </div>

                <div className="gateway-form-row">
                  <label>Card Number</label>
                  <input 
                    type="text" 
                    placeholder="4111 2222 3333 4444" 
                    value={cardNumber} 
                    onChange={handleCardNumberChange} 
                    required 
                  />
                </div>

                <div className="gateway-form-grid">
                  <div className="gateway-form-row">
                    <label>Expiration Date</label>
                    <input 
                      type="text" 
                      placeholder="MM/YY" 
                      value={cardExpiry} 
                      onChange={handleExpiryChange} 
                      maxLength="5"
                      required 
                    />
                  </div>
                  <div className="gateway-form-row">
                    <label>CVV Code</label>
                    <input 
                      type="password" 
                      placeholder="123" 
                      value={cardCvv} 
                      onChange={(e) => setCardCvv(e.target.value.replace(/\D/g, '').substring(0, 3))} 
                      maxLength="3"
                      required 
                    />
                  </div>
                </div>

                <button type="submit" className="gateway-submit-btn">
                  AUTHORIZE SECURE PAYMENT
                </button>
              </form>
            )}

            {/* Cryptographic Checkout */}
            {gatewayTab === 'crypto' && (
              <div className="crypto-checkout-flow">
                <p className="crypto-instruction">Scan this secure QR code, or send exact funds to the address below.</p>
                
                {/* Visual Mock QR Code */}
                <div className="crypto-qr-container">
                  <svg width="120" height="120" viewBox="0 0 100 100" style={{ background: '#fff', padding: '5px', borderRadius: '8px' }}>
                    <rect x="0" y="0" width="25" height="25" fill="#000"/>
                    <rect x="5" y="5" width="15" height="15" fill="#fff"/>
                    <rect x="75" y="0" width="25" height="25" fill="#000"/>
                    <rect x="80" y="5" width="15" height="15" fill="#fff"/>
                    <rect x="0" y="75" width="25" height="25" fill="#000"/>
                    <rect x="5" y="80" width="15" height="15" fill="#fff"/>
                    {/* Mock data pixels */}
                    <rect x="35" y="10" width="10" height="10" fill="#000"/>
                    <rect x="50" y="25" width="15" height="10" fill="#000"/>
                    <rect x="30" y="50" width="20" height="15" fill="#000"/>
                    <rect x="65" y="60" width="10" height="20" fill="#000"/>
                    <rect x="80" y="45" width="10" height="15" fill="#000"/>
                  </svg>
                </div>

                <div className="crypto-address-box">
                  <label>BTC DEPOSIT ADDRESS</label>
                  <div className="copyable-input-group">
                    <input 
                      type="text" 
                      value="bc1qneoncasino777spinwheelpayouts902" 
                      readOnly 
                    />
                    <button type="button" onClick={() => navigator.clipboard.writeText("bc1qneoncasino777spinwheelpayouts902")}>
                      📋 COPY
                    </button>
                  </div>
                </div>

                <button type="button" className="gateway-submit-btn" onClick={startProcessingFlow}>
                  VALIDATE BLOCKCHAIN DEPOSIT
                </button>
              </div>
            )}
          </>
        )}

        {/* Processing State */}
        {processingState === 'processing' && (
          <div className="gateway-status-layout">
            <div className="gateway-spinner"></div>
            <h4>PROCESSING FUNDS</h4>
            <p className="loading-stage-text">{loadingStepText}</p>
          </div>
        )}

        {/* Success State */}
        {processingState === 'success' && (
          <div className="gateway-status-layout success-view">
            <div className="success-checkmark-icon">✓</div>
            <h4>PAYMENT COMPLETED</h4>
            <p>Your wallet has been credited successfully. Redirecting...</p>
          </div>
        )}

        {/* Error State */}
        {processingState === 'error' && (
          <div className="gateway-status-layout error-view">
            <div className="error-x-icon">✕</div>
            <h4>PAYMENT FAILED</h4>
            <p>Verification timed out or card declined. Please retry.</p>
            <button className="gateway-retry-btn" onClick={() => setProcessingState('form')}>
              RETURN TO FORM
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default WalletPanel;
