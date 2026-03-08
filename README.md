# Trading Panel

Solana 代币监控 + 鲸鱼持仓聚类分析的 Telegram Bot。

## 功能

### 价格异动监控
- `/watch <CA>` — 添加代币到监控列表
- `/unwatch <CA>` — 移除监控
- `/list` — 查看监控列表

触发条件（满足任意一条推送告警）：
| 窗口 | 涨幅阈值 |
|------|----------|
| 5 分钟 | ≥ 10% |
| 4 小时 | ≥ 50% |

过滤条件：市值 ≥ $50,000，上线 ≥ 48 小时，无增发/冻结权限。

### CA 聚类分析（`/ca <CA>`）
对一个合约地址同时分析**近期交易者**和**链上大户**，找出它们共同持有或近期有过交易的代币，用于识别钱包集群行为。

分析流程：
1. **交易者发现** — 抓取最近 500 笔成交，去重后过滤刷量地址
2. **大户发现** — Solana RPC `getProgramAccounts` 拉取链上持仓前 100 名
3. **持仓 & 交易查询** — 每个地址各查前 20 持仓 + 近 100 笔交易记录
4. **聚类输出** — 仅展示 ≥ 2 人同时涉及、持仓总值 ≥ $5 的代币

输出 4 个聚类表格，可点击代币按钮查看对应钱包地址列表。

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env` 并填写：

```env
# 代理（大陆环境必填）
HTTPS_PROXY=http://127.0.0.1:10808

# OKX Web3 API（在 https://web3.okx.com/onchain-os/dev-portal 申请）
OKX_API_KEY=
OKX_SECRET_KEY=
OKX_PASSPHRASE=

# Solana RPC（推荐 Helius 免费档：https://helius.dev）
SOLANA_RPC=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY

# Telegram（@BotFather 获取 token；群组/频道 ID 填 TELEGRAM_CHAT_ID）
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

### 3. 启动

```bash
npm start
```

## 项目结构

```
src/
├── index.js                  # 入口：启动监控 + Telegram 长轮询
├── proxy.js                  # 加载 .env + undici ProxyAgent
├── config/
│   ├── alerts.js             # 告警触发规则
│   └── telegram.js           # Bot token / chat ID / topHolderCount
├── data/
│   ├── okx/
│   │   ├── client.js         # HMAC-SHA256 签名请求封装
│   │   ├── market.js         # 价格、K线、成交、交易者地址
│   │   ├── token.js          # 价格信息、持仓人列表、代币搜索
│   │   ├── portfolio.js      # 钱包持仓、总资产
│   │   ├── traders.js        # OKX 内部 PnL 排行（无需鉴权）
│   │   └── wallet.js         # 钱包历史交易（无需鉴权）
│   └── solana/
│       └── holders.js        # Solana RPC getProgramAccounts
├── services/
│   ├── monitor.js            # 价格异动轮询（每 30 秒）
│   └── analyzer.js           # 聚类分析逻辑
└── bot/
    └── commands.js           # Telegram 命令分发 + 消息格式化
```

## API 依赖

| 来源 | 用途 |
|------|------|
| [OKX Web3 API](https://web3.okx.com/onchain-os/dev-portal) | 价格、持仓、交易数据（需鉴权） |
| OKX 内部 priapi | PnL 排行、钱包历史（无需鉴权） |
| Solana RPC | 链上持仓人列表 |
| Telegram Bot API | 消息推送、命令交互 |

## 刷量过滤逻辑

一笔买入 → 同一地址 → 同等金额卖出（误差 < 1%），中间无其他钱包介入，判定为刷量并排除。

## 注意事项

- `/ca` 分析约需 **1–2 分钟**，期间 Bot 会发送进度提示
- 会话结果保留最近 10 次，过期后点击按钮会提示重新运行
- OKX 持仓人接口单次最多返回 20 条，大户列表改用 Solana RPC 获取（无数量限制）
