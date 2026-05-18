# Trading Panel

> Read this in: English · [简体中文](./README.zh-CN.md)

Telegram bot for Solana on-chain whale-cluster analysis + 5-minute net-buy ranking real-time monitor.

## Features

### 5m net-buy scanner (automatic)

Pulls the Solana net-buy ranking from Jupiter datapi every minute and pushes to Telegram:

- Market cap < $1M
- 5m net inflow ≥ $1,000
- Liquidity ≥ $5,000
- Listed ≥ 72 hours
- Contract permissions (mint/freeze) revoked + has social media

Tokens that match the criteria automatically trigger a **fast holdings cluster check**: query the top 100 holders' current portfolios. If any token is co-held by ≥ 9 wallets (excluding SOL, stables, target token), send a cluster alert.

### CA cluster analysis (`/ca <CA>`)

For a contract address, simultaneously analyze **recent traders** and **on-chain whales**, find tokens they commonly hold or recently traded. Used to identify wallet-cluster behavior.

Analysis flow:

1. **Trader discovery**: fetch the latest 500 trades, dedupe and filter wash addresses, take up to 100 wallets
2. **Whale discovery**: Solana RPC `getProgramAccounts` pulls the top 100 on-chain holders
3. **Holdings & trade query**: for each address, query top 50 holdings + last 100 trades
4. **Cluster output**: only show tokens involved by ≥ 2 wallets with total holding value ≥ $5

Outputs 4 cluster tables. Click a token button to see the corresponding wallet list.

## Quick start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy `.env.example` to `.env` and fill in:

```env
# Proxy (required in mainland China)
HTTPS_PROXY=http://127.0.0.1:10808

# OKX Web3 API (apply at https://web3.okx.com/onchain-os/dev-portal)
OKX_API_KEY=
OKX_SECRET_KEY=
OKX_PASSPHRASE=

# Solana RPC (public nodes don't support Token-2022, recommend Helius free tier: https://helius.dev)
SOLANA_RPC=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY

# Telegram (get token from @BotFather; group/channel ID goes in TELEGRAM_CHAT_ID)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

### 3. Start

```bash
npm start
```

## Project structure

```
src/
├── index.js                  # Entry: starts scanner + Telegram long-polling
├── proxy.js                  # Loads .env + undici ProxyAgent
├── config/
│   └── telegram.js           # Bot token / chat ID / topHolderCount
├── data/
│   ├── okx/
│   │   ├── client.js         # HMAC-SHA256 signed request wrapper
│   │   ├── market.js         # Price, K-line, trades, trader addresses (with wash filter)
│   │   ├── token.js          # Price info, holder list, token search
│   │   ├── portfolio.js      # Wallet holdings, total assets
│   │   ├── traders.js        # OKX internal PnL ranking (no auth needed)
│   │   ├── wallet.js         # Wallet trade history (no auth, max 100 per page)
│   │   └── discovery.js      # Jupiter datapi 5m net-buy ranking
│   └── solana/
│       └── holders.js        # Solana RPC getProgramAccounts (Token-2022 supported)
├── services/
│   ├── scanner.js            # Scheduled scan: pull and push net-buy ranking every 60s
│   └── analyzer.js           # /ca cluster analysis logic
└── bot/
    └── commands.js           # Telegram command dispatch + message formatting
```

## API dependencies

| Source | Purpose | Auth |
|--------|---------|------|
| [OKX Web3 API](https://web3.okx.com/onchain-os/dev-portal) | Price, holdings, trade data | HMAC-SHA256 |
| OKX internal priapi | PnL ranking, wallet history | None |
| [Helius](https://helius.dev) / Solana RPC | On-chain holder list | API Key |
| [Jupiter datapi](https://datapi.jup.ag) | 5m net-buy discovery | None |
| Telegram Bot API | Message push, command interaction | Bot Token |

## Wash filter logic

A buy → same address → equal-amount sell (error < 1%), with no other wallet involved in between, is judged as a wash trade and excluded.

## Notes

- `/ca` analysis takes about **1-2 minutes**. The bot sends progress updates during the wait.
- Session results retain the last 10 runs. Clicking buttons after expiry shows a hint to re-run.
- Token-2022 (pump.fun) holder queries require Helius RPC. Public nodes will reject the request.

## License

MIT
