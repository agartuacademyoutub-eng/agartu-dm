// Аудитория демографиясы: жазылушылар (follower_demographics) және салыстыру үшін
// соңғы ~30 күндегі белсенді (engaged) және қамтылған (reached) аудитория. IG әр бөліністе топ-45 береді.
import { cfg } from './config.js';
import { decrypt } from './crypto.js';

const G = () => `https://graph.instagram.com/${cfg.graphVersion}`;
export const METRICS = { followers: 'follower_demographics', engaged: 'engaged_audience_demographics', reached: 'reached_audience_demographics' };
export const BREAKDOWNS = ['gender', 'age', 'country', 'city', 'age,gender'];

async function get(path, token) {
  const res = await fetch(`${G()}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error ? `${json.error.code} ${json.error.message}` : String(res.status));
  return json;
}

// { followers: { gender: { M: 5682, ... }, city: {...} }, engaged: {...}, reached: {...} }
export async function demographics(acc) {
  const token = decrypt(acc.access_token, cfg.encKey);
  const out = {};
  await Promise.all(Object.entries(METRICS).flatMap(([k, metric]) => BREAKDOWNS.map(async (b) => {
    const tf = k === 'followers' ? '' : '&timeframe=this_month';
    try {
      const r = await get(`me/insights?metric=${metric}&period=lifetime&metric_type=total_value&breakdown=${b}${tf}`, token);
      const rows = r.data?.[0]?.total_value?.breakdowns?.[0]?.results || [];
      (out[k] ||= {})[b] = Object.fromEntries(rows.map((x) => [x.dimension_values.join('|'), x.value]));
    } catch {
      (out[k] ||= {})[b] = null;
    }
  })));
  return out;
}

export const GENDER = { M: 'Ер', F: 'Әйел', U: 'Көрсетілмеген' };
export const AGES = ['13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'];

const COUNTRY = {
  KZ: 'Қазақстан', UZ: 'Өзбекстан', KG: 'Қырғызстан', RU: 'Ресей', TR: 'Түркия', KR: 'Оңтүстік Корея', TJ: 'Тәжікстан', CN: 'Қытай',
  MN: 'Моңғолия', US: 'АҚШ', DE: 'Германия', AE: 'БАӘ', SA: 'Сауд Арабиясы', EG: 'Египет', AZ: 'Әзербайжан', TM: 'Түрікменстан',
  GB: 'Ұлыбритания', PL: 'Польша', CZ: 'Чехия', IT: 'Италия', FR: 'Франция', ES: 'Испания', CA: 'Канада', MY: 'Малайзия',
  ID: 'Индонезия', UA: 'Украина', BY: 'Беларусь', GE: 'Грузия', AM: 'Армения', IN: 'Үндістан', PK: 'Пәкістан', AF: 'Ауғанстан',
  IR: 'Иран', QA: 'Катар', KW: 'Кувейт', JP: 'Жапония', NL: 'Нидерланд', AT: 'Австрия', CH: 'Швейцария', SE: 'Швеция', FI: 'Финляндия',
  LT: 'Литва', LV: 'Латвия', EE: 'Эстония', TH: 'Тайланд', VN: 'Вьетнам', IL: 'Израиль', CY: 'Кипр', HU: 'Венгрия', BE: 'Бельгия',
  BD: 'Бангладеш', SK: 'Словакия', CM: 'Камерун', JO: 'Иордания', UG: 'Уганда', SY: 'Сирия', RS: 'Сербия', PT: 'Португалия', SO: 'Сомали',
};
export const countryName = (c) => COUNTRY[c] || c;

const CITY = {
  Almaty: 'Алматы', Shymkent: 'Шымкент', Tselinograd: 'Астана', Astana: 'Астана', 'Nur-Sultan': 'Астана', Aktobe: 'Ақтөбе', Atyrau: 'Атырау',
  Kaskelen: 'Қаскелең', Karaganda: 'Қарағанды', Taraz: 'Тараз', Kyzylorda: 'Қызылорда', Uralsk: 'Орал', Oral: 'Орал', Aktau: 'Ақтау',
  Turkestan: 'Түркістан', Semey: 'Семей', Semipalatinsk: 'Семей', Pavlodar: 'Павлодар', 'Ust-Kamenogorsk': 'Өскемен', Oskemen: 'Өскемен',
  Kostanay: 'Қостанай', Petropavl: 'Петропавл', Petropavlovsk: 'Петропавл', Taldykorgan: 'Талдықорған', Zhanaozen: 'Жаңаөзен',
  Kokshetau: 'Көкшетау', Ekibastuz: 'Екібастұз', Kapchagay: 'Қонаев', Konaev: 'Қонаев', Talgar: 'Талғар', Esik: 'Есік', Issyk: 'Есік',
  Zhezkazgan: 'Жезқазған', Temirtau: 'Теміртау', Kentau: 'Кентау', Saryagash: 'Сарыағаш', Zharkent: 'Жаркент', Balkhash: 'Балқаш',
  Kulsary: 'Құлсары', Beyneu: 'Бейнеу', Aral: 'Арал', Shu: 'Шу', Baikonur: 'Байқоңыр', Satpayev: 'Сәтбаев', Shchuchinsk: 'Щучинск',
  Uzynagash: 'Ұзынағаш', Shamalgan: 'Шамалған', Otegen: 'Өтеген батыр', Turgen: 'Түрген', Lenger: 'Ленгер', Arys: 'Арыс',
  Tashkent: 'Ташкент', Bishkek: 'Бішкек', Moscow: 'Мәскеу', Yangier: 'Янгиер', Samarkand: 'Самарқанд', Nukus: 'Нүкіс', Osh: 'Ош',
  Istanbul: 'Стамбул', Seoul: 'Сеул', 'Saint Petersburg': 'Санкт-Петербург', Novosibirsk: 'Новосибирск', Omsk: 'Омбы', Orenburg: 'Орынбор',
  Astrakhan: 'Астрахан', Chirchiq: 'Шыршық', Andijan: 'Әндіжан', Fergana: 'Ферғана', Namangan: 'Наманған', Bukhara: 'Бұхара',
  Türkistan: 'Түркістан', "Kul'sary": 'Құлсары', Öskemen: 'Өскемен', Energeticheskiy: 'Энергетический (Алматы обл.)', Tyuratam: 'Төретам',
  Shieli: 'Шиелі', Turtkul: 'Тұрткүл', Boralday: 'Боралдай', 'Belye Vody': 'Ақсу (Сайрам ауд.)', 'Kyzyl-Kiya': 'Қызыл-Қия', Merke: 'Мерке',
  Aksu: 'Ақсу (Павлодар обл.)', Zachagansk: 'Зачаганск', 'Jalal-Abad': 'Жалал-Абад', Atakent: 'Атакент', 'Ssary-Agatsch': 'Сарыағаш',
  'Kara-Balta': 'Қара-Балта', Temirlan: 'Темірлан', Sayram: 'Сайрам', Zhetisay: 'Жетісай', Shardara: 'Шардара', Asyk: 'Асықата',
};
// "Almaty, Almaty Region" → "Алматы"; білмейтін қала ағылшынша толық қалады
export const cityName = (c) => CITY[c.split(', ')[0]] || c;
