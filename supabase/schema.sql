create table if not exists accounts (
  ig_user_id text primary key,
  username text,
  access_token text not null,          -- AES-256-GCM, TOKEN_ENC_KEY
  token_expires_at timestamptz,
  updated_at timestamptz default now()
);

create table if not exists dm_logs (
  comment_id text primary key,         -- бір комментке бір DM
  ig_user_id text not null,
  from_id text,
  from_username text,
  media_id text,
  text text,
  status text not null,                -- processing | sent | error | rate_limited
  error text,
  created_at timestamptz default now(),
  sent_at timestamptz
);
create index if not exists dm_logs_acc_time on dm_logs (ig_user_id, created_at desc);

create table if not exists phone_leads (
  id bigserial primary key,
  ig_user_id text,
  from_id text,
  from_username text,
  phone text,
  message text,
  created_at timestamptz default now()
);

create table if not exists bot_errors (
  id bigserial primary key,
  where_at text,
  message text,
  created_at timestamptz default now()
);

-- Тек service_role қолжетімді (policy жоқ = anon/authenticated ештеңе көрмейді)
alter table accounts enable row level security;
alter table dm_logs enable row level security;
alter table phone_leads enable row level security;
alter table bot_errors enable row level security;

-- Instagram статистикасы: күніне бір жол (Алматы күні)
create table if not exists ig_stats_daily (
  ig_user_id text not null,
  day date not null,
  followers int,                       -- сол күнгі жалпы саны (тек cron жазған күндер)
  follows int,
  media_count int,
  new_followers int,
  unfollows int,
  reach int,
  views int,
  accounts_engaged int,
  total_interactions int,
  likes int,
  comments int,
  shares int,
  saves int,
  profile_links_taps int,
  updated_at timestamptz default now(),
  primary key (ig_user_id, day)
);
alter table ig_stats_daily enable row level security;

-- Воронка: триггер-комменттер (+, дұға, ...) және сол адам Директке нөмір қалдырды ма
create table if not exists funnel_comments (
  comment_id text primary key,
  ig_user_id text not null,
  media_id text not null,
  from_id text,
  username text,
  text text,
  flow_id bigint,
  created_at timestamptz not null,
  phone text,                          -- адамның осы комменттен кейінгі алғашқы нөмірі
  phone_at timestamptz,
  is_lead boolean default false,       -- нөмір осы комментке жазылды (адамның нөмірге дейінгі соңғы комменті)
  checked_at timestamptz
);
create index if not exists funnel_c_media on funnel_comments (ig_user_id, media_id);
create index if not exists funnel_c_from on funnel_comments (ig_user_id, from_id);
alter table funnel_comments enable row level security;

-- Посттағы жалпы коммент саны (синхрондау кезіндегі)
create table if not exists funnel_media (
  ig_user_id text not null,
  media_id text not null,
  comments_total int,
  synced_at timestamptz default now(),
  primary key (ig_user_id, media_id)
);
alter table funnel_media enable row level security;
alter table funnel_media add column if not exists posted_at timestamptz;
alter table funnel_media add column if not exists media_type text;
alter table funnel_media add column if not exists caption text;
alter table funnel_media add column if not exists permalink text;
alter table funnel_media add column if not exists likes int;
alter table funnel_media add column if not exists reach int;
alter table funnel_media add column if not exists views int;
alter table funnel_media add column if not exists shares int;
alter table funnel_media add column if not exists saves int;
-- Reels: орташа/жалпы көру уақыты, алғашқы 3 секундта өткізіп жіберу %, видео ұзақтығы (mp4 mvhd-ден)
alter table funnel_media add column if not exists avg_watch_ms int;
alter table funnel_media add column if not exists total_watch_ms bigint;
alter table funnel_media add column if not exists skip_rate real;
alter table funnel_media add column if not exists duration_s real;

-- Сторис статистикасы: IG оны 24 сағаттан кейін бермейді, сондықтан watch cron сағат сайын жинап отырады
create table if not exists story_stats (
  story_id text primary key,
  ig_user_id text not null,
  posted_at timestamptz,
  media_type text,
  permalink text,
  reach int,
  views int,
  replies int,
  shares int,
  interactions int,
  follows int,
  profile_visits int,
  tap_forward int,
  tap_back int,
  tap_exit int,
  swipe_forward int,
  updated_at timestamptz default now()
);
create index if not exists story_stats_acc on story_stats (ig_user_id, posted_at);
alter table story_stats enable row level security;

-- Әр 10 минуттық тексеріс (api/cron/watch): API бұғатталса false, TG хабары тек күй өзгергенде
alter table accounts add column if not exists api_ok boolean not null default true;

-- Жұмысқа келу: қызметкер топқа сурет жібереді (api/telegram). Күннің алғашқы суреті = келу уақыты.
create table if not exists checkins (
  id bigserial primary key,
  emp_key text not null,               -- Telegram user id немесе "sig:<каналдағы қолтаңба>"
  name text not null,
  day date not null,                   -- Алматы күні
  at timestamptz not null,
  chat_id bigint,
  message_id bigint,
  created_at timestamptz default now(),
  unique (chat_id, message_id)         -- Telegram қайта жіберсе, екі рет жазылмасын
);
create index if not exists checkins_day on checkins (day, emp_key);
alter table checkins enable row level security;

create table if not exists att_settings (key text primary key, value text);
alter table att_settings enable row level security;

-- Ескі Reels-ті пробный етіп қайта салу кезегі (api/cron/repost). rank = бастапқы reach, үлкені бірінші.
-- status: queued → container (IG өңдеп жатыр) → done | error | skip
create table if not exists repost_queue (
  source_id text primary key,
  ig_user_id text not null,
  source_permalink text,
  source_posted_at timestamptz,
  rank int,
  status text not null default 'queued',
  container_id text,
  storage_key text,
  new_media_id text,
  new_permalink text,
  error text,
  started_at timestamptz,
  published_at timestamptz,
  updated_at timestamptz default now()
);
create index if not exists repost_queue_next on repost_queue (ig_user_id, status, rank desc);
alter table repost_queue enable row level security;
