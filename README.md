# 🎰 Cyber Casino — Application Architecture

> **Monorepo:** `cyber-casino-monorepo`  
> **Stack:** Node.js · NestJS · React (Vite) · PostgreSQL · Redis · BullMQ · Socket.IO · Docker

---

## 📁 Repository Structure

```
secure-casino-spinwheel/
├── frontend/                  # Player-facing React SPA (Vite)
├── admin-frontend/            # Admin/Backoffice React SPA (Vite)
├── apps/
│   ├── lottery-engine/        # Core game server (NestJS + WebSocket + REST)
│   ├── backoffice-api/        # Admin REST API (NestJS)
│   ├── loyalty-engine/        # Points & rewards microservice (NestJS)
│   └── payout-worker/         # Async payout job processor (NestJS + BullMQ)
├── packages/
│   └── shared/                # Shared utilities & types
├── tests/
│   └── playwright/            # End-to-end (E2E) & API automated test suite
├── Dockerfile                 # Unified multi-stage build
├── docker-compose.yml         # Local orchestration
└── fly.toml                   # Fly.io deployment config
```

---

## 🧩 Service Map

| Service           | Port  | Protocol       | Role                                  |
|-------------------|-------|----------------|---------------------------------------|
| `lottery-engine`  | 8080  | HTTP + WS      | Game logic, sessions, real-time play  |
| `backoffice-api`  | 5001  | HTTP REST      | Admin controls, analytics, user mgmt  |
| `loyalty-engine`  | 5002  | HTTP REST      | XP, levels, rewards, leaderboard      |
| `payout-worker`   | —     | BullMQ Worker  | Processes async withdrawal/payout jobs|
| `postgres`        | 5432  | TCP            | Persistent data store                 |
| `redis`           | 6379  | TCP            | Cache, sessions, job queues           |

---

## 🏗️ Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                          CLIENT LAYER                           │
│                                                                 │
│   ┌──────────────────────┐    ┌──────────────────────────────┐  │
│   │   Player Frontend    │    │      Admin Frontend          │  │
│   │   (React + Vite)     │    │      (React + Vite)          │  │
│   │                      │    │                              │  │
│   │ • SpinWheel Game     │    │ • User Management            │  │
│   │ • Crash Game         │    │ • Financial Reports          │  │
│   │ • Dice Game          │    │ • Game Config                │  │
│   │ • Slots Game         │    │ • Affiliate Dashboard        │  │
│   │ • Lottery Game       │    │ • Backoffice Dashboard       │  │
│   │ • Plinko Game        │    └──────────────────────────────┘  │
│   │ • Wallet Panel       │              │ HTTP REST              │
│   │ • User Profile       │              │ :5001                  │
│   │ • Live Chat          │                                      │
│   └──────────────────────┘                                      │
│        │ HTTP REST + WebSocket                                  │
│        │ :8080                                                  │
└────────┼────────────────────────────────────────────────────────┘
         │
┌────────▼────────────────────────────────────────────────────────┐
│                        SERVICE LAYER                            │
│                                                                 │
│  ┌─────────────────────┐    ┌──────────────────────────────┐   │
│  │   lottery-engine    │    │      backoffice-api          │   │
│  │   :8080             │    │      :5001                   │   │
│  │                     │    │                              │   │
│  │ • Auth (JWT)        │    │ • Admin Auth                 │   │
│  │ • Game Sessions     │◄───┤ • User CRUD                  │   │
│  │ • Provably Fair RNG │    │ • Transaction Reports        │   │
│  │ • Crash Daemon      │    │ • Game Config                │   │
│  │ • Bet Processing    │    │ • Affiliate Tracking         │   │
│  │ • Socket.IO Rooms   │    └──────────────────────────────┘   │
│  │ • Chat System       │                                       │
│  └──────────┬──────────┘    ┌──────────────────────────────┐   │
│             │               │      loyalty-engine          │   │
│             │               │      :5002                   │   │
│             │               │                              │   │
│             └──────────────►│ • XP & Level System          │   │
│                             │ • Reward Redemption          │   │
│                             │ • Leaderboard                │   │
│                             └──────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────┐                                        │
│  │   payout-worker     │  ◄── BullMQ Queue Consumer            │
│  │   (no port)         │                                        │
│  │                     │                                        │
│  │ • Process Withdrawals│                                       │
│  │ • Payout Validation  │                                       │
│  │ • Failure Retries    │                                       │
│  └─────────────────────┘                                        │
└─────────────────────────────────────────────────────────────────┘
         │                    │
┌────────▼────────────────────▼───────────────────────────────────┐
│                        DATA LAYER                               │
│                                                                 │
│   ┌──────────────────────┐    ┌──────────────────────────────┐  │
│   │   PostgreSQL :5432   │    │       Redis :6379            │  │
│   │                      │    │                              │  │
│   │ • users              │    │ • Session Tokens             │  │
│   │ • bets               │    │ • Rate Limiting              │  │
│   │ • transactions       │    │ • Socket Presence            │  │
│   │ • games              │    │ • BullMQ Job Queues          │  │
│   │ • affiliates         │    │ • Crash Game State           │  │
│   │ • loyalty_points     │    │ • Pub/Sub Channels           │  │
│   │ • payouts            │    └──────────────────────────────┘  │
│   └──────────────────────┘                                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🎮 Game Modules (Frontend)

| Component              | Game Type     | Description                                  |
|------------------------|---------------|----------------------------------------------|
| `SpinWheelGame.jsx`    | Spin Wheel    | Segmented wheel with multiplier rewards       |
| `CyberCrashGame.jsx`   | Crash         | Provably fair multiplier crash mechanic       |
| `CyberDiceGame.jsx`    | Dice          | Over/Under dice with adjustable win chance    |
| `CyberSlotsGame.jsx`   | Slots         | Symbol reel slot machine                      |
| `LotteryGame.jsx`      | Lottery       | Ticket-based lottery with draws               |
| `NeonPlinko.jsx`       | Plinko        | Physics-based peg board with multipliers      |

---

## 🔐 Auth & Security Flow

```
Player                  lottery-engine              PostgreSQL / Redis
  │                          │                            │
  ├─ POST /auth/register ───►│                            │
  │                          ├─ Hash password (bcrypt) ──►│
  │                          ├─ Insert user ──────────────►│
  │◄── JWT Token ────────────┤                            │
  │                          │                            │
  ├─ POST /auth/login ──────►│                            │
  │                          ├─ Verify credentials ───────►│
  │                          ├─ Sign JWT (secret) ─────────│
  │                          ├─ Store session in Redis ────►│
  │◄── JWT Token ────────────┤                            │
  │                          │                            │
  ├─ WS connect (JWT) ──────►│                            │
  │                          ├─ Verify token from Redis ──►│
  │◄── Authenticated Socket ─┤                            │
```

---

## ⚙️ Backend Services Deep Dive

### `lottery-engine` — Core Game Server
- **Framework:** NestJS + Express + Socket.IO
- **Responsibilities:**
  - Player authentication (JWT)
  - All 6 game session management
  - Provably fair seed / hash chain generation
  - Real-time WebSocket events (bet, win, multiplier tick)
  - Chat room management
  - Wallet credit/debit
  - Crash game daemon (`crashDaemon.js`)

### `backoffice-api` — Admin REST API
- **Framework:** NestJS + Express
- **Responsibilities:**
  - Admin JWT authentication (separate secret)
  - User listing, banning, balance adjustments
  - Financial transaction reports
  - Game parameter configuration
  - Affiliate link tracking & commission calculation

### `loyalty-engine` — Rewards Microservice
- **Framework:** NestJS + Express
- **Responsibilities:**
  - Award XP on every resolved bet (called by lottery-engine)
  - Level-up calculations
  - Reward catalogue & redemption
  - Leaderboard rankings (Redis sorted sets)

### `payout-worker` — Async Job Processor
- **Queue:** BullMQ (backed by Redis)
- **Responsibilities:**
  - Consumes `payout` jobs produced by lottery-engine
  - Validates withdrawal requests
  - Applies cooldown / fraud checks
  - Marks transactions `completed` or `failed` in PostgreSQL
  - Configurable concurrency via `RUN_WORKER_CONCURRENTLY`

---

## 🗄️ Data Model (Key Tables)

```sql
-- Core entities
users            (id, username, email, password_hash, balance, role, created_at)
sessions         (token, user_id, expires_at)                      -- also in Redis
bets             (id, user_id, game, amount, multiplier, outcome, created_at)
transactions     (id, user_id, type, amount, status, ref, created_at)
payouts          (id, user_id, amount, method, status, processed_at)

-- Game-specific
crash_rounds     (id, seed, hash, multiplier, players_json, ended_at)
lottery_draws    (id, seed, winning_numbers, pot, drawn_at)
lottery_tickets  (id, draw_id, user_id, numbers, purchased_at)

-- Engagement
loyalty_points   (user_id, xp, level, updated_at)
affiliates       (id, user_id, code, commission_rate, total_earned)
affiliate_clicks (id, affiliate_id, referred_user_id, created_at)
```

---

## 🐳 Docker Infrastructure

```yaml
# docker-compose.yml services
redis:          # redis:alpine          — in-memory store + queues
postgres:       # postgres:15-alpine    — persistent DB (volume: pg-data)
lottery-engine: # custom Dockerfile     — :8080
backoffice-api: # custom Dockerfile     — :5001
loyalty-engine: # custom Dockerfile     — :5002
payout-worker:  # custom Dockerfile     — no port (queue worker)
```

**Unified Dockerfile** — single multi-stage image, `working_dir` switched per service via `docker-compose` overrides.

---

## 🚀 Deployment (Fly.io)

- Configured via `fly.toml`
- Single app deployment — services run as separate Fly machines or processes
- Secrets managed via `fly secrets set`
- Persistent Postgres via Fly managed Postgres cluster
- Redis via Upstash Redis (external, connected via `REDIS_URL`)

---

## 📡 Real-Time Communication

```
Client ──── Socket.IO ────► lottery-engine
                                 │
              Events:            │
              ┌──────────────────┤
              │ bet:place        │ Client → Server
              │ bet:result       │ Server → Client
              │ crash:tick       │ Server → All (broadcast)
              │ crash:cashout    │ Client → Server
              │ crash:bust       │ Server → All
              │ chat:message     │ Client → Server → All in room
              │ wallet:update    │ Server → Client (private)
              │ leaderboard:sync │ Server → All
              └──────────────────┘
```

---

## 🔄 Async Job Flow (Payout)

```
lottery-engine                  Redis (BullMQ)              payout-worker
     │                               │                           │
     ├── bet resolved, withdraw ─────►│                           │
     │   queue.add('payout', data)   │                           │
     │                               ├── job available ──────────►│
     │                               │                           ├─ validate
     │                               │                           ├─ process
     │                               │                           ├─ update DB
     │                               │                           ├─ emit event
     │◄─ socket: wallet:update ───────────────────────────────────┤
```

---

## 🧰 Tech Stack Summary

| Layer         | Technology                          |
|---------------|-------------------------------------|
| Frontend      | React 18, Vite, Socket.IO client    |
| Backend       | Node.js, NestJS, Socket.IO server   |
| Testing       | Playwright (E2E & API tests)        |
| Auth          | JWT (`jsonwebtoken`), bcrypt         |
| Database      | PostgreSQL 15 (pg driver)           |
| Cache / Queue | Redis + BullMQ + ioredis            |
| Geo / Security| geoip-lite, CORS, rate limiting     |
| Container     | Docker, Docker Compose              |
| Deployment    | Fly.io                              |
| Monorepo      | npm workspaces                      |

---

## 🛠️ Local Dev — Quick Start

```bash
# 1. Start infrastructure
docker-compose up redis postgres -d

# 2. Install all dependencies
npm run bootstrap

# 3. Start all backend services
npm run start:engine

# 4. Start player frontend
npm run start:frontend      # http://localhost:3000

# 5. Start admin frontend
npm run start:admin         # http://localhost:3001
```

---

## 🧪 Testing

```bash
# Run Playwright E2E and API smoke tests
npx playwright test
```

---

## 🔒 Environment Variables

| Variable               | Service(s)               | Description                    |
|------------------------|--------------------------|--------------------------------|
| `NODE_ENV`             | All                      | `development` / `production`   |
| `PORT`                 | lottery/backoffice/loyalty| HTTP listen port               |
| `REDIS_URL`            | All                      | Redis connection string        |
| `PGHOST/USER/PASS/DB`  | All                      | PostgreSQL credentials         |
| `JWT_SECRET`           | lottery-engine           | Player token signing key       |
| `ADMIN_JWT_SECRET`     | backoffice-api           | Admin token signing key        |
| `RUN_WORKER_CONCURRENTLY` | payout/lottery-engine | BullMQ concurrency flag        |

---

*Generated: 2026-07-19 | Cyber Casino Monorepo v1.0.0*
