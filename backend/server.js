const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

// Prepopulated mock database with realistic leaderboard entries
const USERS = {
  'demo@casino.com': {
    username: 'DemoPlayer',
    email: 'demo@casino.com',
    password: 'password123',
    balance: 1000,
    gamesPlayed: 15,
    totalWon: 320
  },
  'cyber_ninja@casino.com': {
    username: 'CyberNinja',
    email: 'cyber_ninja@casino.com',
    password: '123',
    balance: 8430,
    gamesPlayed: 145,
    totalWon: 9320
  },
  'lucky_strike@casino.com': {
    username: 'LuckyStrike',
    email: 'lucky_strike@casino.com',
    password: '123',
    balance: 4120,
    gamesPlayed: 88,
    totalWon: 5210
  },
  'volt_spinner@casino.com': {
    username: 'VoltSpinner',
    email: 'volt_spinner@casino.com',
    password: '123',
    balance: 290,
    gamesPlayed: 45,
    totalWon: 1350
  },
  'glitch_wizard@casino.com': {
    username: 'GlitchWizard',
    email: 'glitch_wizard@casino.com',
    password: '123',
    balance: 5600,
    gamesPlayed: 102,
    totalWon: 6780
  }
};

// Global transaction history store (Prepopulated for demo account)
const TRANSACTIONS = [
  {
    email: 'demo@casino.com',
    id: 'TX-DEMO-001',
    type: 'WELCOME_BONUS',
    amount: 1000,
    balanceAfter: 1000,
    timestamp: new Date(Date.now() - 3600000 * 2).toISOString()
  }
];

// Helper to generate transaction IDs
const generateTxId = () => `TX-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

// Backend defines the true prizes and colors
const PRIZES = [
  { text: '10% CASHBACK', color: '#ff0055', textColor: '#ffffff' },
  { text: 'TRY AGAIN', color: '#111122', textColor: '#ffffff' },
  { text: 'FREE $10', color: '#00ffcc', textColor: '#000000' },
  { text: 'NO LUCK', color: '#1a1a30', textColor: '#ffffff' },
  { text: 'JACKPOT x5', color: '#ffcc00', textColor: '#000000' },
  { text: '20% BONUS', color: '#b500ff', textColor: '#ffffff' }
];

// Register Endpoint
app.post('/api/auth/register', (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ success: false, error: 'All fields are required.' });
    }
    if (USERS[email.toLowerCase()]) {
      return res.status(400).json({ success: false, error: 'User already exists.' });
    }

    const newUser = {
      username,
      email: email.toLowerCase(),
      password,
      balance: 1000,
      gamesPlayed: 0,
      totalWon: 0
    };

    USERS[email.toLowerCase()] = newUser;

    // Log welcome transaction
    TRANSACTIONS.push({
      email: newUser.email,
      id: generateTxId(),
      type: 'WELCOME_BONUS',
      amount: 1000,
      balanceAfter: 1000,
      timestamp: new Date().toISOString()
    });

    console.log(`[SECURE LOG] Registered: ${username} (${email.toLowerCase()})`);

    res.json({
      success: true,
      user: {
        username: newUser.username,
        email: newUser.email,
        balance: newUser.balance,
        gamesPlayed: 0,
        totalWon: 0
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// Login Endpoint
app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'All fields are required.' });
    }

    const user = USERS[email.toLowerCase()];
    if (!user || user.password !== password) {
      return res.status(400).json({ success: false, error: 'Invalid email or password.' });
    }

    console.log(`[SECURE LOG] Logged in: ${user.username}`);

    res.json({
      success: true,
      user: {
        username: user.username,
        email: user.email,
        balance: user.balance,
        gamesPlayed: user.gamesPlayed,
        totalWon: user.totalWon
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});



// Mock Deposit Endpoint
app.post('/api/user/deposit', (req, res) => {
  try {
    const { email, amount } = req.body;
    const depAmount = parseFloat(amount);
    if (!email || isNaN(depAmount) || depAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid deposit amount.' });
    }

    const user = USERS[email.toLowerCase()];
    if (!user) {
      return res.status(400).json({ success: false, error: 'User session not found.' });
    }

    user.balance += depAmount;

    TRANSACTIONS.push({
      email: user.email,
      id: generateTxId(),
      type: 'DEPOSIT',
      amount: depAmount,
      balanceAfter: user.balance,
      timestamp: new Date().toISOString()
    });

    console.log(`[SECURE LOG] Deposit: ${user.username} (Amount: +$${depAmount}, New Balance: $${user.balance})`);

    res.json({
      success: true,
      newBalance: user.balance
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// Mock Withdrawal Endpoint
app.post('/api/user/withdraw', (req, res) => {
  try {
    const { email, amount } = req.body;
    const withAmount = parseFloat(amount);
    if (!email || isNaN(withAmount) || withAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid withdrawal amount.' });
    }

    const user = USERS[email.toLowerCase()];
    if (!user) {
      return res.status(400).json({ success: false, error: 'User session not found.' });
    }

    if (user.balance < withAmount) {
      return res.status(400).json({ success: false, error: 'Insufficient balance to withdraw.' });
    }

    user.balance -= withAmount;

    TRANSACTIONS.push({
      email: user.email,
      id: generateTxId(),
      type: 'WITHDRAWAL',
      amount: -withAmount,
      balanceAfter: user.balance,
      timestamp: new Date().toISOString()
    });

    console.log(`[SECURE LOG] Withdrawal: ${user.username} (Amount: -$${withAmount}, New Balance: $${user.balance})`);

    res.json({
      success: true,
      newBalance: user.balance
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// Fetch Wallet Transactions
app.get('/api/user/wallet', (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ success: false, error: 'User email required.' });
    }

    // Filter transactions and sort by newest first
    const userTx = TRANSACTIONS
      .filter(tx => tx.email === email.toLowerCase())
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({
      success: true,
      transactions: userTx
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// Fetch Leaderboard Listings
app.get('/api/leaderboard', (req, res) => {
  try {
    // Generate active online player roster dynamically
    const leaderboard = Object.values(USERS)
      .map(u => ({
        username: u.username,
        gamesPlayed: u.gamesPlayed,
        totalWon: u.totalWon,
        isOnline: Math.random() > 0.35
      }))
      .sort((a, b) => b.totalWon - a.totalWon);

    res.json({
      success: true,
      leaderboard
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// Secure Stateful Spin Endpoint (Deducts & adds win logs)
app.post('/api/spin', (req, res) => {
  try {
    const { email } = req.body;
    const user = USERS[email?.toLowerCase()];
    if (!user) {
      return res.status(400).json({ success: false, error: 'Invalid session. Please log in.' });
    }

    const SPIN_COST = 10;
    if (user.balance < SPIN_COST) {
      return res.status(400).json({ success: false, error: 'Insufficient balance! Refill your wallet.' });
    }

    // Deduct cost and update games counter
    user.balance -= SPIN_COST;
    user.gamesPlayed += 1;

    // Log the spin cost transaction
    TRANSACTIONS.push({
      email: user.email,
      id: generateTxId(),
      type: 'SPIN_PLAY',
      amount: -SPIN_COST,
      balanceAfter: user.balance,
      timestamp: new Date().toISOString()
    });

    // Secure RNG Selector
    const winningIndex = crypto.randomInt(0, PRIZES.length);
    const prize = PRIZES[winningIndex];

    // Compute Payouts
    let payout = 0;
    if (prize.text === 'FREE $10') {
      payout = 10;
    } else if (prize.text === 'JACKPOT x5') {
      payout = 50;
    } else if (prize.text === '20% BONUS') {
      payout = 20;
    }

    if (payout > 0) {
      user.balance += payout;
      user.totalWon += payout;

      // Log the winning payout transaction
      TRANSACTIONS.push({
        email: user.email,
        id: generateTxId(),
        type: 'SPIN_WINOUT',
        amount: payout,
        balanceAfter: user.balance,
        timestamp: new Date().toISOString()
      });
    }

    console.log(`[SECURE LOG] Spin: ${user.username}. Cost: -$10, Won: ${prize.text} (+$${payout}). Wallet: $${user.balance}`);

    res.json({
      success: true,
      winningIndex,
      prizeText: prize.text,
      newBalance: user.balance,
      gamesPlayed: user.gamesPlayed,
      totalWon: user.totalWon
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

const SLOT_SYMBOLS = ['BAR', 'CHERRY', 'BELL', 'DIAMOND', 'SEVEN', 'WILD'];
const SLOT_MULTIPLIERS = {
  'BAR': 3,
  'CHERRY': 5,
  'BELL': 10,
  'DIAMOND': 20,
  'SEVEN': 50,
  'WILD': 100
};

app.post('/api/slots/spin', (req, res) => {
  try {
    const { email, bet } = req.body;
    const betAmount = parseFloat(bet);

    if (!email || isNaN(betAmount) || betAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid bet details.' });
    }

    const user = USERS[email.toLowerCase()];
    if (!user) {
      return res.status(400).json({ success: false, error: 'User session not found.' });
    }

    if (user.balance < betAmount) {
      return res.status(400).json({ success: false, error: 'Insufficient funds for this bet.' });
    }

    // Deduct bet and log transaction
    user.balance -= betAmount;
    user.gamesPlayed += 1;

    TRANSACTIONS.push({
      email: user.email,
      id: generateTxId(),
      type: 'SLOTS_PLAY',
      amount: -betAmount,
      balanceAfter: user.balance,
      timestamp: new Date().toISOString()
    });

    // Roll 3 reels
    const r1 = SLOT_SYMBOLS[crypto.randomInt(0, SLOT_SYMBOLS.length)];
    const r2 = SLOT_SYMBOLS[crypto.randomInt(0, SLOT_SYMBOLS.length)];
    const r3 = SLOT_SYMBOLS[crypto.randomInt(0, SLOT_SYMBOLS.length)];
    const reels = [r1, r2, r3];

    // Payout Calculation
    let payout = 0;
    const counts = {};
    reels.forEach(sym => counts[sym] = (counts[sym] || 0) + 1);
    
    const wildCount = counts['WILD'] || 0;
    
    // Find non-wild counts
    const nonWilds = Object.keys(counts).filter(sym => sym !== 'WILD');
    let maxNonWildCount = 0;
    let maxNonWildSymbol = null;
    nonWilds.forEach(sym => {
      if (counts[sym] > maxNonWildCount) {
        maxNonWildCount = counts[sym];
        maxNonWildSymbol = sym;
      }
    });

    if (wildCount === 3) {
      payout = betAmount * SLOT_MULTIPLIERS['WILD'];
    } else if (wildCount === 2) {
      // 2 wilds + 1 other symbol = 3 of that other symbol
      payout = betAmount * SLOT_MULTIPLIERS[maxNonWildSymbol || 'WILD'];
    } else if (wildCount === 1) {
      if (maxNonWildCount === 2) {
        // 1 wild + 2 matching = 3 matching
        payout = betAmount * SLOT_MULTIPLIERS[maxNonWildSymbol];
      } else {
        // 1 wild + 2 different = 2-of-a-kind (consolation win)
        payout = betAmount * 2;
      }
    } else {
      // 0 wilds
      if (maxNonWildCount === 3) {
        payout = betAmount * SLOT_MULTIPLIERS[maxNonWildSymbol];
      } else if (maxNonWildCount === 2) {
        payout = betAmount * 2;
      } else {
        payout = 0;
      }
    }

    // Add payout and log transaction if won
    if (payout > 0) {
      user.balance += payout;
      user.totalWon += payout;

      TRANSACTIONS.push({
        email: user.email,
        id: generateTxId(),
        type: 'SLOTS_WINOUT',
        amount: payout,
        balanceAfter: user.balance,
        timestamp: new Date().toISOString()
      });
    }

    console.log(`[SECURE LOG] Slots: ${user.username} bet $${betAmount}. Rolled: ${reels.join('-')}. Won: $${payout}. Balance: $${user.balance}`);

    res.json({
      success: true,
      reels,
      payout,
      newBalance: user.balance,
      gamesPlayed: user.gamesPlayed,
      totalWon: user.totalWon
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

app.post('/api/lottery/draw', (req, res) => {
  try {
    const { email, bet, chosenNumbers } = req.body;
    const betAmount = parseFloat(bet);

    if (!email || isNaN(betAmount) || betAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid draw details.' });
    }

    if (!Array.isArray(chosenNumbers) || chosenNumbers.length !== 6) {
      return res.status(400).json({ success: false, error: 'Must choose exactly 6 numbers.' });
    }

    const uniqueNumbers = [...new Set(chosenNumbers)];
    if (uniqueNumbers.length !== 6 || uniqueNumbers.some(num => isNaN(num) || num < 1 || num > 49)) {
      return res.status(400).json({ success: false, error: 'Must choose unique numbers between 1 and 49.' });
    }

    const user = USERS[email.toLowerCase()];
    if (!user) {
      return res.status(400).json({ success: false, error: 'User session not found.' });
    }

    if (user.balance < betAmount) {
      return res.status(400).json({ success: false, error: 'Insufficient funds to purchase lottery ticket.' });
    }

    // Deduct ticket cost
    user.balance -= betAmount;
    user.gamesPlayed += 1;

    TRANSACTIONS.push({
      email: user.email,
      id: generateTxId(),
      type: 'LOTTERY_PLAY',
      amount: -betAmount,
      balanceAfter: user.balance,
      timestamp: new Date().toISOString()
    });

    // Draw 6 unique random numbers (1 to 49)
    const drawNumbers = [];
    while (drawNumbers.length < 6) {
      const num = crypto.randomInt(1, 50);
      if (!drawNumbers.includes(num)) {
        drawNumbers.push(num);
      }
    }
    drawNumbers.sort((a, b) => a - b);

    // Count matches
    const matchedNumbers = uniqueNumbers.filter(num => drawNumbers.includes(num));
    const matchCount = matchedNumbers.length;

    // Multiplier map
    let multiplier = 0;
    if (matchCount === 3) multiplier = 2;
    else if (matchCount === 4) multiplier = 10;
    else if (matchCount === 5) multiplier = 100;
    else if (matchCount === 6) multiplier = 10000;

    const payout = betAmount * multiplier;

    if (payout > 0) {
      user.balance += payout;
      user.totalWon += payout;

      TRANSACTIONS.push({
        email: user.email,
        id: generateTxId(),
        type: 'LOTTERY_WINOUT',
        amount: payout,
        balanceAfter: user.balance,
        timestamp: new Date().toISOString()
      });
    }

    console.log(`[SECURE LOG] Lottery: ${user.username} bet $${betAmount} on [${uniqueNumbers.join(',')}]. Draw: [${drawNumbers.join(',')}]. Matches: ${matchCount}. Payout: $${payout}`);

    res.json({
      success: true,
      drawNumbers,
      matchedNumbers,
      payout,
      newBalance: user.balance,
      gamesPlayed: user.gamesPlayed,
      totalWon: user.totalWon
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// Serve static frontend in production
const path = require('path');
app.use(express.static(path.join(__dirname, 'dist')));

// Redirect any other route to frontend Single Page App index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`>>>> Secure Casino Backend running on port ${PORT}`));
