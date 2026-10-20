'use strict';
// test-cases.js — автоматические тест-кейсы. Запуск: npm test (Node.js) или вкладка «Проверка работы» в браузере.

function runTests() {
  const T = [];
  const t = (id, kind, scenario, expected, fn) => T.push({ id, kind, scenario, expected, fn });
  const mk = (s, type, lines, extra) => {
    const d = blankDoc(type);
    Object.assign(d, type === DocType.IN ? { partnerId: 1 } : { reason: 'Брак' }, extra || {});
    d.lines = lines.map(([itemId, qty]) => ({ itemId, qty: String(qty) }));
    return saveDoc(s, d);
  };

  t('T-01', 'Основной', 'Приходная накладная: «Паллета EUR» +15 (было 120) и «Стрейч-плёнка» +10 (было 18) — провести', 'Остатки 135 и 28, документ «Проведён», в журнале 2 записи', () => {
    const s = makeSeedStore(false);
    const d = mk(s, DocType.IN, [[1, 15], [2, 10]]);
    const r = postDoc(s, d.id);
    return { pass: r.ok && s.items[0].qty === 135 && s.items[1].qty === 28 && d.status === DocStatus.POSTED && s.log.length === 2, actual: `Остатки ${s.items[0].qty} и ${s.items[1].qty}, статус «${DOC_STATUS_LABEL[d.status]}», записей в журнале: ${s.log.length}` };
  });
  t('T-02', 'Основной', 'Акт списания: «Паллета EUR» −20 по причине «Брак» — провести', 'Остаток 100, документ «Проведён», запись типа «списание»', () => {
    const s = makeSeedStore(false);
    const d = mk(s, DocType.OUT, [[1, 20]]);
    const r = postDoc(s, d.id);
    return { pass: r.ok && s.items[0].qty === 100 && s.log[0].type === 'out' && s.log[0].docNumber === d.number, actual: `Остаток ${s.items[0].qty}, тип записи: ${s.log[0] ? s.log[0].type : '—'}, документ ${s.log[0] ? s.log[0].docNumber : '—'}` };
  });
  t('T-03', 'Основной', 'Сохранить черновик приходной накладной, не проводя', 'Номер ПН-0001, статус «Черновик», остаток прежний (120)', () => {
    const s = makeSeedStore(false);
    const d = mk(s, DocType.IN, [[1, 50]]);
    return { pass: d.number === 'ПН-0001' && d.status === DocStatus.DRAFT && s.items[0].qty === 120 && s.log.length === 0, actual: `Номер ${d.number}, статус «${DOC_STATUS_LABEL[d.status]}», остаток ${s.items[0].qty}` };
  });
  t('T-04', 'Основной', 'Отменить проведение накладной на +15 «Паллета EUR»', 'Остаток вернулся к 120, документ «Отменён»', () => {
    const s = makeSeedStore(false);
    const d = mk(s, DocType.IN, [[1, 15]]);
    postDoc(s, d.id);
    const r = cancelDoc(s, d.id);
    return { pass: r.ok && s.items[0].qty === 120 && d.status === DocStatus.CANCELLED, actual: `Остаток ${s.items[0].qty}, статус «${DOC_STATUS_LABEL[d.status]}»` };
  });
  t('T-05', 'Основной', 'Поиск «ПЛЁНКА» (верхний регистр, буква Ё)', 'Найдена «Стрейч-плёнка 500 мм»', () => {
    const s = makeSeedStore(false);
    const r = searchItems(s.items, 'ПЛЁНКА');
    return { pass: r.length === 1 && r[0].sku === 'FLM-500', actual: `Найдено: ${r.length} (${r.map(x => x.name).join(', ') || '—'})` };
  });
  t('T-06', 'Ошибка ввода', 'Провести приходную накладную без строк', 'Отказ с сообщением «Добавьте хотя бы одну строку», статус «Черновик»', () => {
    const s = makeSeedStore(false);
    const d = mk(s, DocType.IN, []);
    const r = postDoc(s, d.id);
    return { pass: !r.ok && r.errors.some(e => e.includes('хотя бы одну строку')) && d.status === DocStatus.DRAFT, actual: r.ok ? 'Документ проведён' : `Отказ: «${r.errors.join('; ')}»` };
  });
  t('T-07', 'Ошибка ввода', 'Акт списания из 2 строк: «Паллета» −10 (допустимо) и «Плёнка» −500 при остатке 18', 'Отказ целиком: остатки не изменились, журнал пуст', () => {
    const s = makeSeedStore(false);
    const d = mk(s, DocType.OUT, [[1, 10], [2, 500]]);
    const r = postDoc(s, d.id);
    return { pass: !r.ok && s.items[0].qty === 120 && s.items[1].qty === 18 && s.log.length === 0, actual: r.ok ? 'Документ проведён' : `Отказ: «${r.errors[0]}»; остатки ${s.items[0].qty} и ${s.items[1].qty}, журнал: ${s.log.length}` };
  });
  t('T-08', 'Ошибка ввода', 'Повторно провести уже проведённый документ', 'Отказ, остаток не удвоился', () => {
    const s = makeSeedStore(false);
    const d = mk(s, DocType.IN, [[1, 10]]);
    postDoc(s, d.id);
    const r = postDoc(s, d.id);
    return { pass: !r.ok && s.items[0].qty === 130, actual: r.ok ? 'Проведён второй раз' : `Отказ: «${r.errors[0]}», остаток ${s.items[0].qty}` };
  });
  t('T-09', 'Ошибка ввода', 'Добавить позицию в справочник с пустым названием («   »)', 'Позиция не добавлена, ошибка у поля «Название»', () => {
    const s = makeSeedStore(false), n = s.items.length;
    const r = addItem(s, { name: '   ', category: 'Упаковка', unit: 'шт', min: '5' });
    return { pass: !r.ok && !!r.errors.name && s.items.length === n, actual: r.ok ? 'Позиция добавлена' : `Отклонено: «${r.errors.name}»` };
  });
  t('T-10', 'Граничный', 'Акт списания ровно на весь остаток (120 из 120)', 'Остаток 0, статус «Нет на складе»', () => {
    const s = makeSeedStore(false);
    const d = mk(s, DocType.OUT, [[1, 120]]);
    const r = postDoc(s, d.id);
    return { pass: r.ok && s.items[0].qty === 0 && getStatus(s.items[0]) === Status.OUT, actual: `Остаток ${s.items[0].qty}, статус: ${STATUS_LABEL[getStatus(s.items[0])]}` };
  });
  t('T-11', 'Граничный', 'Остаток равен минимуму (10 при минимуме 10) и на единицу выше (11)', '10 → «Заканчивается», 11 → «В наличии»', () => {
    const a = getStatus({ qty: 10, min: 10 }), b = getStatus({ qty: 11, min: 10 });
    return { pass: a === Status.LOW && b === Status.OK, actual: `10 → ${STATUS_LABEL[a]}, 11 → ${STATUS_LABEL[b]}` };
  });

  t('T-12', 'Ошибка ввода', 'Провести приходную накладную без поставщика', 'Отказ: «Выберите поставщика из списка контрагентов», остаток не изменился', () => {
    const s = makeSeedStore(false);
    const d = mk(s, DocType.IN, [[1, 10]], { partnerId: null });
    const r = postDoc(s, d.id);
    return { pass: !r.ok && r.errors.some(e => e.includes('поставщика')) && s.items[0].qty === 120, actual: r.ok ? 'Документ проведён' : `Отказ: «${r.errors[0]}», остаток ${s.items[0].qty}` };
  });
  t('T-13', 'Ошибка ввода', 'Добавить контрагента с названием, которое уже есть («тоо «промупак»»)', 'Отказ: «Такой контрагент уже есть в списке»', () => {
    const s = makeSeedStore(false), n = s.partners.length;
    const r = addPartner(s, { name: 'тоо «промупак»', kind: 'supplier', bin: '', phone: '' });
    return { pass: !r.ok && !!r.errors.name && s.partners.length === n, actual: r.ok ? 'Контрагент добавлен' : `Отказ: «${r.errors.name}»` };
  });
  t('T-14', 'Основной', 'Акт списания «Отгрузка покупателю» (ТОО «АлмаТрейд»): «Паллета EUR» −30', 'Остаток 90, в документе указан покупатель', () => {
    const s = makeSeedStore(false);
    const d = mk(s, DocType.OUT, [[1, 30]], { reason: 'Отгрузка покупателю', partnerId: 4 });
    const r = postDoc(s, d.id);
    return { pass: r.ok && s.items[0].qty === 90 && d.party === 'ТОО «АлмаТрейд»', actual: `Остаток ${s.items[0].qty}, покупатель: ${d.party || '—'}` };
  });

  t('T-15', 'Основной', 'Исправить проведённую накладную: +15 «Паллета EUR» заменить на +25 и провести снова', 'После правки остаток 120, после повторного проведения 145', () => {
    const s = makeSeedStore(false);
    const d = mk(s, DocType.IN, [[1, 15]]);
    postDoc(s, d.id);
    const u = unpostDoc(s, d.id);
    const afterUnpost = s.items[0].qty;
    d.lines[0].qty = '25';
    const r = postDoc(s, d.id);
    return { pass: u.ok && afterUnpost === 120 && r.ok && s.items[0].qty === 145 && d.status === DocStatus.POSTED, actual: `После снятия проведения ${afterUnpost}, после повторного проведения ${s.items[0].qty}, статус «${DOC_STATUS_LABEL[d.status]}»` };
  });
  t('T-16', 'Ошибка ввода', 'Править накладную +15, когда товар уже списан (остаток 5 < 15)', 'Отказ, документ остаётся проведённым, остаток 5', () => {
    const s = makeSeedStore(false);
    const a = mk(s, DocType.IN, [[1, 15]]);
    postDoc(s, a.id);
    const b = mk(s, DocType.OUT, [[1, 130]]);
    postDoc(s, b.id);
    const u = unpostDoc(s, a.id);
    return { pass: !u.ok && a.status === DocStatus.POSTED && s.items[0].qty === 5, actual: u.ok ? 'Проведение снято' : `Отказ: «${u.errors[0]}»; остаток ${s.items[0].qty}` };
  });

  t('T-17', 'Ошибка ввода', 'Провести приходную накладную с датой в будущем (01.01.2999)', 'Отказ: «Дата документа не может быть в будущем», остаток не изменился', () => {
    const s = makeSeedStore(false);
    const d = mk(s, DocType.IN, [[1, 10]], { date: '2999-01-01' });
    const r = postDoc(s, d.id);
    return { pass: !r.ok && r.errors.some(e => e.includes('в будущем')) && s.items[0].qty === 120, actual: r.ok ? 'Документ проведён' : `Отказ: «${r.errors[0]}», остаток ${s.items[0].qty}` };
  });
  t('T-18', 'Граничный', 'Списание «Паллета EUR» −90 (остаток 120 → 30, минимум 30)', 'Документ проведён, предупреждение «ниже минимума»', () => {
    const s = makeSeedStore(false);
    const d = mk(s, DocType.OUT, [[1, 90]]);
    const r = postDoc(s, d.id);
    return { pass: r.ok && s.items[0].qty === 30 && r.warnings.length === 1 && r.warnings[0].includes('ниже минимума'), actual: r.ok ? `Остаток ${s.items[0].qty}, предупреждений: ${r.warnings.length}${r.warnings[0] ? ' («' + r.warnings[0] + '»)' : ''}` : 'Отказ: ' + r.errors[0] };
  });

  return T.map(x => {
    try { const r = x.fn(); return { id: x.id, kind: x.kind, scenario: x.scenario, expected: x.expected, actual: r.actual, pass: r.pass }; }
    catch (e) { return { id: x.id, kind: x.kind, scenario: x.scenario, expected: x.expected, actual: 'Исключение: ' + e.message, pass: false }; }
  });
}
