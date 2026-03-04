import 'dotenv/config';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
if (proxy) {
  setGlobalDispatcher(new ProxyAgent(proxy));
  console.log(`[proxy] ${proxy}`);
}
