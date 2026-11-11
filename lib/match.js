// Коммент триггерге сәйкес пе.
// "+" сияқты символ-триггер: комментте сол символ бар болса жеткілікті ("+", "++", "+ 🔥").
// Сөз-триггер ("гайд"): регистрге қарамай, жеке сөз ретінде кездессе.
export function matchesTrigger(text, triggers) {
  if (!text) return false;
  const t = text.toLowerCase().trim();
  return triggers.some((raw) => {
    const trig = raw.toLowerCase();
    if (!/[\p{L}\p{N}]/u.test(trig)) return t.includes(trig);
    const esc = trig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}($|[^\\p{L}\\p{N}])`, 'u').test(t);
  });
}

// Коммент қай сценарийге түседі: priority бойынша бірінші сәйкес келгені.
export function pickFlow(text, flows) {
  return flows.find((f) => matchesTrigger(text, f.keywords || [])) || null;
}

// Мәтіннен Қазақстан/Ресей нөмірін табу. Табылса +7XXXXXXXXXX қайтарады.
export function extractPhone(text) {
  if (!text) return null;
  const candidates = text.match(/\+?\d[\d\s\-()]{8,}\d/g) || [];
  for (const c of candidates) {
    let d = c.replace(/\D/g, '');
    if (d.length === 11 && (d[0] === '8' || d[0] === '7')) d = '7' + d.slice(1);
    else if (d.length === 10 && d[0] === '7') d = '7' + d;
    else continue;
    return '+' + d;
  }
  return null;
}
