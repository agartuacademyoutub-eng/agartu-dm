import { cfg } from './config.js';

export async function tg(text) {
  if (!cfg.tgToken || !cfg.tgChatIds.length) return;
  await Promise.all(
    cfg.tgChatIds.map((chat_id) =>
      fetch(`https://api.telegram.org/bot${cfg.tgToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id, text, disable_web_page_preview: true }),
      }).catch(() => {}),
    ),
  );
}
