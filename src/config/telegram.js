/**
 * Telegram Bot 配置
 * 敏感字段从 .env 读取
 */
export const telegramConfig = {
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  chatId:   process.env.TELEGRAM_CHAT_ID,

  // /ca 查询：分析前 N 大户地址（Solana RPC，无上限）
  topHolderCount: 100,
};
