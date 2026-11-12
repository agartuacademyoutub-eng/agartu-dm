// Барлық баптау env-тен. Мәтіндерді Vercel env-те өзгертуге болады.
const e = process.env;

export const cfg = {
  appUrl: (e.APP_URL || '').replace(/\/$/, ''),
  igAppId: e.INSTAGRAM_APP_ID,
  igAppSecret: e.INSTAGRAM_APP_SECRET,
  metaAppSecret: e.META_APP_SECRET,
  verifyToken: e.META_WEBHOOK_VERIFY_TOKEN,
  encKey: e.TOKEN_ENC_KEY,
  cronSecret: e.CRON_SECRET,
  supabaseUrl: (e.SUPABASE_URL || '').replace(/\/$/, ''),
  supabaseKey: e.SUPABASE_SERVICE_ROLE_KEY,
  tgToken: e.TG_BOT_TOKEN,
  tgChatIds: (e.TG_CHAT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
  triggers: (e.TRIGGERS || '+').split('|').map((s) => s.trim()).filter(Boolean),
  dmText:
    e.DM_TEXT ||
    'Қайырлы күн! Видеомызға + қалдырған екенсіз😊 Номер қалдырсаңыз сізге курс жайлы толық ақпарат беретін боламыз👇',
  publicReply:
    e.PUBLIC_REPLY || 'Дайректіңізге жаздық. Егер хабарлама келмесе, запрос бөлімін қарап көріңіз!',
  hourlyLimit: 600,
  graphVersion: 'v23.0',
  statsKey: e.STATS_KEY,
  googleSa: e.GOOGLE_SA_JSON,
  sheetId: e.SHEET_ID,
  mainAccount: e.MAIN_ACCOUNT || 'agartu.academy',
  // Ескі Reels-ті пробный етіп қайта салу: аккаунт → күніне неше видео
  repostDaily: Object.fromEntries(
    (e.REPOST_DAILY || 'agartu.academy:10,azamat_tileulin:3,qairat_ustaz:4,ergali.alpysbay:2,rizabekbattaluly_:2').split(',').map((s) => s.split(':')).map(([u, n]) => [u.trim(), Number(n)]),
  ),
  // Пробныйлар арасындағы аралық (минут); жоқ аккаунтқа — GAP_MIN (lib/repost.js)
  repostGap: Object.fromEntries(
    (e.REPOST_GAP || '').split(',').filter(Boolean).map((s) => s.split(':')).map(([u, n]) => [u.trim(), Number(n)]),
  ),
  // Жұмысқа келу (api/telegram): бөлек бот токені болмаса — негізгі TG бот
  attToken: e.ATT_BOT_TOKEN || e.TG_BOT_TOKEN,
  attAdmins: (e.ATT_ADMIN_IDS || e.TG_CHAT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
  attSecret: e.ATT_WEBHOOK_SECRET,
  attWorkStart: e.ATT_WORK_START || '09:00',
  attGraceMin: Number(e.ATT_GRACE_MIN || 0),
  attWorkdays: (e.ATT_WORKDAYS || '1,2,3,4,5').split(',').map(Number), // 1=Дс ... 7=Жс
};

export const SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
  'instagram_business_manage_comments',
  'instagram_business_manage_insights',
  'instagram_business_content_publish', // ескі видеоларды пробный Reels етіп қайта салу
];
