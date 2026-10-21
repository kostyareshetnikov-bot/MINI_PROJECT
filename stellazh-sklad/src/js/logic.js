'use strict';
// logic.js — данные и правила предметной области (без обращения к DOM).
// Используется и в браузере, и в Node.js (tests/run-tests.js).

/* 1. Модель данных: перечисления и структуры */
const Status = Object.freeze({ OK: 'ok', LOW: 'low', OUT: 'out' });
const DocType = Object.freeze({ IN: 'in', OUT: 'out' });
const DocStatus = Object.freeze({ DRAFT: 'draft', POSTED: 'posted', CANCELLED: 'cancelled' });
const STATUS_LABEL = { ok: 'В наличии', low: 'Заканчивается', out: 'Нет на складе' };
const STATUS_ORDER = { out: 0, low: 1, ok: 2 };
const DOC_TITLE = { in: 'Приходная накладная', out: 'Акт списания' };
const DOC_PREFIX = { in: 'ПН', out: 'АС' };
const DOC_STATUS_LABEL = { draft: 'Черновик', posted: 'Проведён', cancelled: 'Отменён' };
const CATEGORIES = ['Упаковка', 'Расходники', 'Оборудование', 'СИЗ', 'Прочее'];
const UNITS = ['шт', 'рул', 'уп', 'пар', 'кг'];
const REASONS = ['Отгрузка покупателю', 'Брак', 'Порча при хранении', 'Истёк срок годности', 'Отгрузка в производство', 'Недостача по инвентаризации', 'Прочее'];
const PARTNER_KIND = { supplier: 'Поставщик', buyer: 'Покупатель' };
const MAX_QTY = 1000000;

/* Позиция:  { id, sku, name, category, unit, location, qty, min }
   Документ: { id, number, type, date, party, reason, person, note, status, postedAt, lines: [{ itemId, qty }] }
   Журнал:   { id, ts, itemId, sku, name, type, qty, balance, note, docId, docNumber } */

function createStore(items, log, docs, partners) {
  const s = {
    items: (items || []).map(i => ({ ...i })),
    log: (log || []).map(l => ({ ...l })),
    docs: (docs || []).map(d => ({ ...d, lines: d.lines.map(l => ({ ...l })) })),
    partners: (partners || []).map(p => ({ ...p }))
  };
  s.nextId = s.items.reduce((m, i) => Math.max(m, i.id), 0) + 1;
  s.nextLogId = s.log.reduce((m, l) => Math.max(m, l.id), 0) + 1;
  s.nextDocId = s.docs.reduce((m, d) => Math.max(m, d.id), 0) + 1;
  s.nextPartnerId = s.partners.reduce((m, p) => Math.max(m, p.id), 0) + 1;
  s.nextNum = { in: 1, out: 1 };
  for (const d of s.docs) {
    const n = parseInt(String(d.number).split('-')[1], 10);
    if (!Number.isNaN(n) && n >= s.nextNum[d.type]) s.nextNum[d.type] = n + 1;
  }
  return s;
}

function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function daysAgoISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function makeSeedStore(withHistory) {
  const raw = [
    ['PAL-EUR', 'Паллета EUR 1200×800', 'Упаковка', 'шт', 'A-01-1', 120, 30],
    ['FLM-500', 'Стрейч-плёнка 500 мм', 'Упаковка', 'рул', 'A-01-2', 18, 20],
    ['BOX-403', 'Картонная коробка 40×30×20', 'Упаковка', 'шт', 'B-03-1', 640, 200],
    ['TAP-48', 'Скотч упаковочный 48 мм', 'Расходники', 'рул', 'B-02-2', 0, 24],
    ['LBL-58', 'Термоэтикетки 58×40', 'Расходники', 'рул', 'C-01-1', 95, 40],
    ['GLV-L', 'Перчатки рабочие, размер L', 'СИЗ', 'пар', 'C-04-3', 36, 50],
    ['VST-SIG', 'Жилет сигнальный', 'СИЗ', 'шт', 'C-04-1', 22, 10],
    ['HPT-25', 'Гидравлическая тележка 2,5 т', 'Оборудование', 'шт', 'D-01', 4, 2],
    ['KNF-18', 'Нож строительный 18 мм', 'Расходники', 'шт', 'B-01-4', 75, 20],
    ['SCN-ZB', 'Сканер штрихкодов', 'Оборудование', 'шт', 'D-02', 6, 3]
  ];
  // Для демо-истории стартуем с остатков «до» документов, чтобы итог совпал с таблицей выше
  const before = { 'PAL-EUR': -40, 'BOX-403': -200, 'FLM-500': -4, 'LBL-58': -50, 'GLV-L': -6, 'TAP-48': 12 };
  const items = raw.map((r, i) => ({
    id: i + 1, sku: r[0], name: r[1], category: r[2], unit: r[3], location: r[4],
    qty: r[5] + (withHistory ? (before[r[0]] || 0) : 0), min: r[6]
  }));
  const partners = [
    { id: 1, name: 'ТОО «ПромУпак»', kind: 'supplier', bin: '190340011223', phone: '+7 727 300-11-22' },
    { id: 2, name: 'ИП Сериков А.', kind: 'supplier', bin: '850512300456', phone: '+7 701 555-12-34' },
    { id: 3, name: 'ТОО «Скотч-Опт»', kind: 'supplier', bin: '210740055667', phone: '+7 727 355-66-77' },
    { id: 4, name: 'ТОО «АлмаТрейд»', kind: 'buyer', bin: '180540033445', phone: '+7 727 311-44-55' },
    { id: 5, name: 'ИП Касымова Д.', kind: 'buyer', bin: '900818400789', phone: '+7 777 123-45-67' },
    { id: 6, name: 'ТОО «Логистик Центр»', kind: 'buyer', bin: '200140077889', phone: '+7 727 390-88-99' }
  ];
  const store = createStore(items, [], [], partners);
  if (!withHistory) return store;

  const idOf = sku => store.items.find(i => i.sku === sku).id;
  const pid = name => store.partners.find(p => p.name === name).id;
  const history = [
    [DocType.IN, daysAgoISO(14), { partnerId: pid('ТОО «ПромУпак»') }, [['PAL-EUR', 40], ['BOX-403', 200], ['FLM-500', 10]]],
    [DocType.IN, daysAgoISO(12), { partnerId: pid('ИП Сериков А.') }, [['LBL-58', 50], ['GLV-L', 20]]],
    [DocType.OUT, daysAgoISO(7), { reason: 'Отгрузка покупателю', partnerId: pid('ТОО «АлмаТрейд»'), person: 'Склад, смена 2' }, [['TAP-48', 12], ['GLV-L', 14], ['FLM-500', 6]]]
  ];
  for (const [type, date, fields, lines] of history) {
    const d = blankDoc(type);
    Object.assign(d, fields, { date });
    d.lines = lines.map(([sku, q]) => ({ itemId: idOf(sku), qty: String(q) }));
    const saved = saveDoc(store, d);
    postDoc(store, saved.id);
    const ts = new Date(date + 'T10:00:00').getTime();
    saved.postedAt = ts;
    store.log.filter(l => l.docId === saved.id).forEach(l => { l.ts = ts; });
  }
  // Черновик, который можно сразу провести
  const draft = blankDoc(DocType.IN);
  Object.assign(draft, { partnerId: pid('ТОО «Скотч-Опт»') });
  draft.lines = [{ itemId: idOf('TAP-48'), qty: '48' }, { itemId: idOf('FLM-500'), qty: '30' }];
  saveDoc(store, draft);
  store.log.sort((a, b) => b.ts - a.ts);
  return store;
}

/* 2. Функции обработки данных */
function normalize(s) {
  return String(s == null ? '' : s).trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
}

function parseIntStrict(v) {
  const t = String(v == null ? '' : v).trim();
  return /^\d+$/.test(t) ? Number(t) : NaN;
}

function getStatus(item) {
  if (item.qty === 0) return Status.OUT;
  if (item.qty <= item.min) return Status.LOW;
  return Status.OK;
}

/* ---- Справочник позиций ---- */
function validateItem(data, store) {
  const errors = {};
  const name = String(data.name || '').trim().replace(/\s+/g, ' ');
  if (!name) errors.name = 'Введите название';
  else if (name.length < 2 || name.length > 60) errors.name = 'Название — от 2 до 60 символов';

  const sku = String(data.sku || '').trim().toUpperCase();
  if (sku) {
    if (!/^[A-ZА-Я0-9-]{3,16}$/.test(sku)) errors.sku = 'Артикул: 3–16 символов, буквы, цифры и дефис';
    else if (store.items.some(i => i.sku === sku)) errors.sku = 'Такой артикул уже есть на складе';
  }
  const loc = String(data.location || '').trim().toUpperCase();
  if (loc && !/^[A-ZА-Я0-9-]{1,12}$/.test(loc)) errors.location = 'Только буквы, цифры и дефис';
  if (!CATEGORIES.includes(data.category)) errors.category = 'Выберите категорию';
  if (!UNITS.includes(data.unit)) errors.unit = 'Выберите единицу';

  const qty = parseIntStrict(data.qty == null ? '0' : data.qty);
  if (Number.isNaN(qty)) errors.qty = 'Целое число, 0 или больше';
  else if (qty > MAX_QTY) errors.qty = 'Слишком большое число';
  const min = parseIntStrict(data.min);
  if (Number.isNaN(min)) errors.min = 'Целое число, 0 или больше';
  else if (min > MAX_QTY) errors.min = 'Не больше ' + MAX_QTY.toLocaleString('ru-RU');
  return errors;
}

function autoSku(store) {
  let n = store.nextId;
  let sku;
  do { sku = 'SKU-' + String(n++).padStart(3, '0'); } while (store.items.some(i => i.sku === sku));
  return sku;
}

function logEntry(store, item, type, qty, note, doc) {
  store.log.unshift({
    id: store.nextLogId++, ts: Date.now(), itemId: item.id, sku: item.sku, name: item.name,
    type, qty, balance: item.qty, note: String(note || '').trim(),
    docId: doc ? doc.id : null, docNumber: doc ? doc.number : ''
  });
}

function addItem(store, data) {
  const errors = validateItem(data, store);
  if (Object.keys(errors).length) return { ok: false, errors };
  const item = {
    id: store.nextId++,
    sku: String(data.sku || '').trim().toUpperCase() || autoSku(store),
    name: String(data.name).trim().replace(/\s+/g, ' '),
    category: data.category,
    unit: data.unit,
    location: String(data.location || '').trim().toUpperCase() || '—',
    qty: parseIntStrict(data.qty == null ? '0' : data.qty),
    min: parseIntStrict(data.min)
  };
  store.items.push(item);
  if (item.qty > 0) logEntry(store, item, DocType.IN, item.qty, 'Начальный остаток', null);
  return { ok: true, item };
}

function isItemUsed(store, itemId) {
  return store.docs.some(d => d.lines.some(l => l.itemId === itemId));
}

function removeItem(store, id) {
  const idx = store.items.findIndex(i => i.id === id);
  if (idx === -1) return { ok: false, error: 'Позиция не найдена' };
  if (isItemUsed(store, id)) return { ok: false, error: 'Позиция есть в документах — удалить нельзя' };
  store.items.splice(idx, 1);
  return { ok: true };
}

function searchItems(items, query, filters) {
  const f = filters || {};
  const tokens = normalize(query).split(' ').filter(Boolean);
  const out = [];
  for (const it of items) {
    if (f.category && it.category !== f.category) continue;
    const st = getStatus(it);
    if (f.status === 'need' && st === Status.OK) continue;
    if (f.status && f.status !== 'need' && st !== f.status) continue;
    const hay = normalize([it.sku, it.name, it.category, it.location].join(' '));
    if (tokens.every(t => hay.includes(t))) out.push(it);
  }
  return out;
}

function calcStats(items) {
  let units = 0, need = 0, out = 0;
  for (const it of items) {
    units += it.qty;
    const st = getStatus(it);
    if (st !== Status.OK) need++;
    if (st === Status.OUT) out++;
  }
  return { positions: items.length, units, need, out };
}

/* ---- Контрагенты ---- */
function validatePartner(store, data, selfId) {
  const errors = {};
  const name = String(data.name || '').trim().replace(/\s+/g, ' ');
  if (!name) errors.name = 'Введите название контрагента';
  else if (name.length < 2 || name.length > 60) errors.name = 'Название — от 2 до 60 символов';
  else if (store.partners.some(p => p.id !== selfId && normalize(p.name) === normalize(name))) errors.name = 'Такой контрагент уже есть в списке';
  if (!PARTNER_KIND[data.kind]) errors.kind = 'Выберите тип';
  const bin = String(data.bin || '').trim();
  if (bin && !/^\d{12}$/.test(bin)) errors.bin = 'БИН/ИИН — ровно 12 цифр';
  const phone = String(data.phone || '').trim();
  if (phone && !/^\+?[\d\s()-]{7,18}$/.test(phone)) errors.phone = 'Телефон: цифры, пробелы, + ( ) -';
  return errors;
}

function addPartner(store, data) {
  const errors = validatePartner(store, data, null);
  if (Object.keys(errors).length) return { ok: false, errors };
  const p = {
    id: store.nextPartnerId++, name: String(data.name).trim().replace(/\s+/g, ' '), kind: data.kind,
    bin: String(data.bin || '').trim(), phone: String(data.phone || '').trim()
  };
  store.partners.push(p);
  return { ok: true, partner: p };
}

function partnerDocCount(store, id) {
  return store.docs.filter(d => d.partnerId === id).length;
}

function updatePartner(store, id, data) {
  const p = store.partners.find(x => x.id === id);
  if (!p) return { ok: false, errors: { name: 'Контрагент не найден' } };
  const errors = validatePartner(store, data, id);
  if (!errors.kind && data.kind !== p.kind && partnerDocCount(store, id) > 0) errors.kind = 'Тип нельзя менять: контрагент есть в документах';
  if (Object.keys(errors).length) return { ok: false, errors };
  p.name = String(data.name).trim().replace(/\s+/g, ' ');
  p.kind = data.kind;
  p.bin = String(data.bin || '').trim();
  p.phone = String(data.phone || '').trim();
  return { ok: true, partner: p };
}

function removePartner(store, id) {
  const idx = store.partners.findIndex(p => p.id === id);
  if (idx === -1) return { ok: false, error: 'Контрагент не найден' };
  if (partnerDocCount(store, id) > 0) return { ok: false, error: 'Контрагент есть в документах — удалить нельзя' };
  store.partners.splice(idx, 1);
  return { ok: true };
}

/* ---- Документы ---- */
function blankDoc(type, presetItemId) {
  return {
    id: null, number: null, type, date: todayISO(), partnerId: null, party: '', reason: '', person: '', note: '',
    status: DocStatus.DRAFT, postedAt: null,
    lines: presetItemId ? [{ itemId: presetItemId, qty: '' }] : []
  };
}

function nextNumber(store, type) {
  return DOC_PREFIX[type] + '-' + String(store.nextNum[type]++).padStart(4, '0');
}

/* Сохранение черновика: новому документу присваиваются id и номер */
function saveDoc(store, doc) {
  const clean = {
    ...doc,
    lines: doc.lines.map(l => ({ itemId: (l.itemId === '' || l.itemId == null) ? '' : Number(l.itemId), qty: l.qty }))
  };
  clean.partnerId = (clean.partnerId === '' || clean.partnerId == null) ? null : Number(clean.partnerId);
  const pr = store.partners.find(x => x.id === clean.partnerId);
  clean.party = pr ? pr.name : '';
  if (clean.id == null) {
    clean.id = store.nextDocId++;
    clean.number = nextNumber(store, clean.type);
    store.docs.unshift(clean);
    return clean;
  }
  const idx = store.docs.findIndex(d => d.id === clean.id);
  if (idx === -1) return null;
  if (store.docs[idx].status !== DocStatus.DRAFT) return store.docs[idx];
  store.docs[idx] = clean;
  return clean;
}

function validateDoc(store, doc) {
  const errors = [];
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(doc.date || '') && !Number.isNaN(new Date(doc.date + 'T00:00:00').getTime());
  if (!dateOk) errors.push('Укажите дату документа');
  else if (doc.date > todayISO()) errors.push('Дата документа не может быть в будущем');
  const partner = store.partners.find(p => p.id === doc.partnerId);
  if (doc.type === DocType.IN) {
    if (!partner) errors.push('Выберите поставщика из списка контрагентов');
    else if (partner.kind !== 'supplier') errors.push(`«${partner.name}» — не поставщик`);
  } else {
    if (!REASONS.includes(doc.reason)) errors.push('Выберите причину списания');
    if (doc.reason === 'Отгрузка покупателю' && !partner) errors.push('Для отгрузки выберите покупателя из списка контрагентов');
    if (partner && partner.kind !== 'buyer') errors.push(`«${partner.name}» — не покупатель`);
  }
  if (!doc.lines.length) { errors.push('Добавьте хотя бы одну строку'); return errors; }

  const seen = new Set();
  doc.lines.forEach((l, i) => {
    const n = i + 1;
    const it = store.items.find(x => x.id === l.itemId);
    if (!it) { errors.push(`Строка ${n}: выберите позицию`); return; }
    const q = parseIntStrict(l.qty);
    if (Number.isNaN(q) || q < 1) errors.push(`Строка ${n}: количество — целое число от 1`);
    else if (doc.type === DocType.OUT && q > it.qty) errors.push(`Строка ${n}: «${it.name}» — на складе только ${it.qty} ${it.unit}`);
    else if (doc.type === DocType.IN && it.qty + q > MAX_QTY) errors.push(`Строка ${n}: остаток «${it.name}» не может превышать ${MAX_QTY.toLocaleString('ru-RU')}`);
    if (seen.has(it.id)) errors.push(`Строка ${n}: «${it.name}» уже есть в документе`);
    seen.add(it.id);
  });
  return errors;
}

/* Проведение: сначала проверяем ВСЕ строки, и только потом меняем остатки (всё или ничего) */
function postDoc(store, id) {
  const doc = store.docs.find(d => d.id === id);
  if (!doc) return { ok: false, errors: ['Документ не найден'] };
  if (doc.status !== DocStatus.DRAFT) return { ok: false, errors: ['Документ уже проведён или отменён'] };
  const errors = validateDoc(store, doc);
  if (errors.length) return { ok: false, errors };
  const partner = store.partners.find(p => p.id === doc.partnerId);
  doc.party = partner ? partner.name : '';
  const note = doc.type === DocType.IN ? doc.party : doc.reason + (doc.party ? ' · ' + doc.party : '');
  for (const l of doc.lines) {
    const it = store.items.find(i => i.id === l.itemId);
    const q = Number(l.qty);
    it.qty += doc.type === DocType.IN ? q : -q;
    l.qty = q;
    logEntry(store, it, doc.type, q, note, doc);
  }
  doc.status = DocStatus.POSTED;
  doc.postedAt = Date.now();
  const warnings = [];
  if (doc.type === DocType.OUT) {
    for (const l of doc.lines) {
      const it = store.items.find(i => i.id === l.itemId);
      const st = getStatus(it);
      if (st === Status.OUT) warnings.push(`«${it.name}» закончился на складе`);
      else if (st === Status.LOW) warnings.push(`«${it.name}» ниже минимума: осталось ${it.qty} ${it.unit}, минимум ${it.min}`);
    }
  }
  return { ok: true, doc, warnings };
}

/* Откат остатков проведённого документа. Возвращает список ошибок (пусто — откат выполнен) */
function reverseDoc(store, doc, note) {
  const errors = [];
  for (const l of doc.lines) {
    const it = store.items.find(i => i.id === l.itemId);
    if (!it) continue;
    if (doc.type === DocType.IN && it.qty < l.qty) errors.push(`«${it.name}»: на складе ${it.qty} ${it.unit}, а нужно вернуть ${l.qty} — товар уже израсходован`);
    if (doc.type === DocType.OUT && it.qty + l.qty > MAX_QTY) errors.push(`«${it.name}»: остаток превысит ${MAX_QTY.toLocaleString('ru-RU')}`);
  }
  if (errors.length) return errors;
  for (const l of doc.lines) {
    const it = store.items.find(i => i.id === l.itemId);
    if (!it) continue;
    it.qty += doc.type === DocType.IN ? -l.qty : l.qty;
    logEntry(store, it, doc.type === DocType.IN ? DocType.OUT : DocType.IN, l.qty, note, doc);
  }
  return [];
}

/* Окончательная отмена документа */
function cancelDoc(store, id) {
  const doc = store.docs.find(d => d.id === id);
  if (!doc) return { ok: false, errors: ['Документ не найден'] };
  if (doc.status !== DocStatus.POSTED) return { ok: false, errors: ['Отменить можно только проведённый документ'] };
  const errors = reverseDoc(store, doc, 'Отмена документа ' + doc.number);
  if (errors.length) return { ok: false, errors };
  doc.status = DocStatus.CANCELLED;
  return { ok: true, doc };
}

/* Правка проведённого документа: остатки откатываются, документ снова становится черновиком */
function unpostDoc(store, id) {
  const doc = store.docs.find(d => d.id === id);
  if (!doc) return { ok: false, errors: ['Документ не найден'] };
  if (doc.status !== DocStatus.POSTED) return { ok: false, errors: ['Править можно только проведённый документ'] };
  const errors = reverseDoc(store, doc, 'Правка документа ' + doc.number + ': проведение снято');
  if (errors.length) return { ok: false, errors };
  doc.status = DocStatus.DRAFT;
  doc.postedAt = null;
  return { ok: true, doc };
}

/* Отменённый документ можно вернуть в черновик (остатки уже откачены) */
function reopenDoc(store, id) {
  const doc = store.docs.find(d => d.id === id);
  if (!doc) return { ok: false, errors: ['Документ не найден'] };
  if (doc.status !== DocStatus.CANCELLED) return { ok: false, errors: ['Вернуть в черновик можно только отменённый документ'] };
  doc.status = DocStatus.DRAFT;
  return { ok: true, doc };
}

function deleteDoc(store, id) {
  const idx = store.docs.findIndex(d => d.id === id);
  if (idx === -1) return { ok: false, error: 'Документ не найден' };
  if (store.docs[idx].status !== DocStatus.DRAFT) return { ok: false, error: 'Удалять можно только черновики' };
  store.docs.splice(idx, 1);
  return { ok: true };
}

function docTotals(doc) {
  let qty = 0;
  for (const l of doc.lines) { const q = parseIntStrict(l.qty); if (!Number.isNaN(q)) qty += q; }
  return { lines: doc.lines.length, qty };
}
