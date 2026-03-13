import 'dotenv/config';
import { Agent, ProxyAgent, setGlobalDispatcher } from 'undici';

const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
if (proxy) {
  setGlobalDispatcher(new ProxyAgent({ uri: proxy, allowH2: false }));
  console.log(`[proxy] ${proxy}`);
} else {
  // 强制 HTTP/1.1，避免 undici HTTP/2 连接池与 Telegram 不兼容
  setGlobalDispatcher(new Agent({ allowH2: false }));
}
