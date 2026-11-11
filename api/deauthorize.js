// Meta deauthorize / data deletion callback-тері. Пайдаланушы өтінсе деректі қолмен өшіреміз.
import { cfg } from '../lib/config.js';

export function POST() {
  const code = Date.now().toString(36);
  return Response.json({ url: `${cfg.appUrl}/privacy#delete`, confirmation_code: code });
}

export function GET() {
  return Response.json({ ok: true });
}
