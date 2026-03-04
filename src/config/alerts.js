/**
 * 异动监控触发条件
 */
export const alertConfig = {
  // 市值过滤（USD）
  minMarketCap: 50_000,

  // 代币最低上线时长（小时）
  minTokenAgHours: 48,

  // 合约权限检查（Solana）
  contract: {
    rejectMintAuthority: true,   // 拒绝保留增发权限
    rejectFreezeAuthority: true, // 拒绝保留冻结权限
  },

  // 价格涨幅触发条件（满足任意一条即告警）
  priceAlerts: [
    { window: '5m',  changePercent: 10  },  // 5 分钟涨幅 ≥ 10%
    { window: '4h',  changePercent: 50  },  // 4 小时涨幅 ≥ 50%
  ],
};
