-- Сценарийлер: әр триггер сөзге өз DM мәтіні мен ашық жауабы.
create table if not exists flows (
  id bigserial primary key,
  name text not null,
  keywords text[] not null,            -- мыс. {'+'} немесе {'гайд','guide'}
  dm_text text not null,
  public_reply text,                   -- null болса ашық жауап жазылмайды
  priority int not null default 100,   -- кішісі бірінші тексеріледі
  active boolean not null default true,
  created_at timestamptz default now()
);
alter table flows enable row level security;

alter table dm_logs add column if not exists flow_id bigint;

-- Осы сценарийден келген адам Директте нөмір қалдырса, Telegram хабарына қосылатын тег
alter table flows add column if not exists lead_tag text;
alter table phone_leads add column if not exists tag text;
create index if not exists dm_logs_from on dm_logs (ig_user_id, from_id, created_at desc);

-- DM астындағы батырмалар: [{"title":"Иә, жіберіңіз","reply":"басқанда кететін мәтін"}]
alter table flows add column if not exists dm_buttons jsonb;
-- Нөмір келгенде адамға кететін жауап (null болса жазылмайды)
alter table flows add column if not exists phone_reply text;

-- Адам қай батырмаларды басты (лидке «Жауаптары» болып қосылады)
create table if not exists dm_answers (
  id bigserial primary key,
  ig_user_id text not null,
  from_id text not null,
  flow_id bigint,
  path text,
  title text,
  created_at timestamptz default now()
);
alter table dm_answers enable row level security;
create index if not exists dm_answers_from on dm_answers (ig_user_id, from_id, created_at desc);

-- Сценарий бұл аккаунттарда (ig_user_id) жұмыс істемейді
alter table flows add column if not exists skip_accounts text[];

-- Батырма басып, нөмір қалдырмағандарға бір реттік еске салу (lib/followup.js)
alter table flows add column if not exists followup_text text;
alter table flows add column if not exists followup_after_min int;
create table if not exists dm_followups (
  id bigserial primary key,
  ig_user_id text not null,
  from_id text not null,
  flow_id bigint not null,
  error text,
  created_at timestamptz default now(),
  unique (ig_user_id, from_id, flow_id)
);
alter table dm_followups enable row level security;
