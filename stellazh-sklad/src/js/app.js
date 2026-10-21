'use strict';
// app.js — хранение в localStorage, отрисовка интерфейса и обработка событий.

/* 3. Хранение */
const KEY = 'stellazh-v3';
function save() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* хранилище недоступно */ } }
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (d && Array.isArray(d.items) && Array.isArray(d.log) && Array.isArray(d.docs) && Array.isArray(d.partners)) return createStore(d.items, d.log, d.docs, d.partners);
  } catch (e) { /* повреждённые данные */ }
  return null;
}
let store = load() || makeSeedStore(true);

/* 4. Интерфейс */
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Number(n).toLocaleString('ru-RU');
const fmtTime = ts => new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmtDate = iso => String(iso || '').split('-').reverse().join('.');
const clone = o => JSON.parse(JSON.stringify(o));

const ui = {
  view: 'stock', q: '', cat: '', status: '', sortKey: 'status', sortDir: 1, pendingDelete: null,
  docFilter: '', doc: null, docErrors: [], confirmDocDelete: false, confirmCancel: false, confirmEdit: false, docNotes: [],
  partnerFilter: '', partnerQ: '', editPartnerId: null, pendingPartnerDelete: null
};

function toast(msg, bad) {
  const el = document.createElement('div');
  el.className = 'toast' + (bad ? ' bad' : '');
  el.textContent = msg;
  $('#toast').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function renderNav() {
  const drafts = store.docs.filter(d => d.status === DocStatus.DRAFT).length;
  const items = [
    ['stock', 'Остатки', store.items.length],
    ['docs', 'Документы', drafts ? drafts + ' черн.' : store.docs.length],
    ['partners', 'Контрагенты', store.partners.length],
    ['log', 'Журнал операций', store.log.length],
    ['tests', 'Проверка работы', '']
  ];
  const cur = ui.view === 'doc' ? 'docs' : ui.view;
  $('#nav').innerHTML = items.map(([v, label, c]) =>
    `<button data-view="${v}" class="${cur === v ? 'active' : ''}"><span>${label}</span><span class="count">${c}</span></button>`).join('');
}

function renderStats() {
  const s = calcStats(store.items);
  $('#stats').innerHTML = `
    <div class="stat"><span class="n">${fmt(s.positions)}</span><span class="l">позиций в справочнике</span></div>
    <div class="stat"><span class="n">${fmt(s.units)}</span><span class="l">единиц на складе</span></div>
    <button class="stat ${s.need ? 'warn' : ''}" data-action="filter-need"><span class="n">${fmt(s.need)}</span><span class="l">нужно пополнить</span></button>
    <div class="stat"><span class="n">${fmt(s.out)}</span><span class="l">нет в наличии</span></div>`;
}

function sortItems(list) {
  const k = ui.sortKey, d = ui.sortDir;
  return list.slice().sort((a, b) => {
    let r = 0;
    if (k === 'name') r = a.name.localeCompare(b.name, 'ru');
    else if (k === 'qty') r = a.qty - b.qty;
    else if (k === 'status') r = STATUS_ORDER[getStatus(a)] - STATUS_ORDER[getStatus(b)] || a.name.localeCompare(b.name, 'ru');
    else if (k === 'location') r = a.location.localeCompare(b.location, 'ru');
    return r * d;
  });
}

function levelBar(it) {
  const st = getStatus(it);
  const ratio = it.min > 0 ? it.qty / (it.min * 4) : (it.qty > 0 ? 1 : 0);
  const on = it.qty === 0 ? 0 : Math.max(1, Math.min(8, Math.round(ratio * 8)));
  let cells = '';
  for (let i = 0; i < 8; i++) cells += `<i class="${i < on ? 'on' : ''}"></i>`;
  return `<div class="bar ${st}" role="img" aria-label="Заполненность ${on} из 8">${cells}</div>`;
}

function th(key, label) {
  const arrow = ui.sortKey === key ? (ui.sortDir === 1 ? '▲' : '▼') : '';
  return `<th><button data-action="sort" data-key="${key}">${label}<span aria-hidden="true">${arrow}</span></button></th>`;
}

function renderTable() {
  const wrap = $('#tableWrap');
  if (!store.items.length) {
    wrap.innerHTML = `<div class="empty"><b>Справочник пуст</b>Добавьте первую позицию, а затем оформите приходную накладную.<br><button class="btn primary" data-action="open-new">Новая позиция</button></div>`;
    return;
  }
  const list = sortItems(searchItems(store.items, ui.q, { category: ui.cat, status: ui.status }));
  if (!list.length) {
    wrap.innerHTML = `<div class="empty"><b>Ничего не найдено</b>Измените запрос или сбросьте фильтры.<br><button class="btn" data-action="reset-filters">Сбросить фильтры</button></div>`;
    return;
  }
  const rows = list.map(it => {
    const st = getStatus(it);
    const del = ui.pendingDelete === it.id;
    return `<tr>
      <td><div class="name">${esc(it.name)}</div><div class="sku">${esc(it.sku)} · ${esc(it.category)}</div></td>
      <td class="loc">${esc(it.location)}</td>
      <td><span class="qty">${fmt(it.qty)}</span> <span class="unit">${esc(it.unit)}</span><span class="minhint">мин. ${fmt(it.min)}</span></td>
      <td>${levelBar(it)}</td>
      <td><span class="badge ${st}">${STATUS_LABEL[st]}</span></td>
      <td><div class="row-actions">
        <button class="mini in" data-action="new-doc" data-type="in" data-item="${it.id}" title="Создать приходную накладную с этой позицией">Приход</button>
        <button class="mini out" data-action="new-doc" data-type="out" data-item="${it.id}" title="Создать акт списания с этой позицией">Списать</button>
        <button class="mini del ${del ? 'confirm' : ''}" data-action="delete" data-id="${it.id}" title="Удалить позицию" aria-label="Удалить позицию ${esc(it.name)}">${del ? 'Удалить?' : '✕'}</button>
      </div></td></tr>`;
  }).join('');
  wrap.innerHTML = `<div class="scroll"><table>
    <thead><tr>${th('name', 'Позиция')}${th('location', 'Ячейка')}${th('qty', 'Остаток')}<th>Уровень</th>${th('status', 'Статус')}<th></th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function renderStock() {
  $('#main').innerHTML = `
    <div class="head">
      <div><h1>Остатки</h1><p class="sub">Что лежит на складе, где оно хранится и что пора заказывать. Остатки меняются только проведёнными документами.</p></div>
      <div class="head-actions">
        <button class="btn" data-action="new-doc" data-type="in">Приходная накладная</button>
        <button class="btn" data-action="new-doc" data-type="out">Акт списания</button>
        <button class="btn primary" data-action="open-new">Новая позиция</button>
      </div>
    </div>
    <div class="stats" id="stats"></div>
    <div class="toolbar">
      <input class="field search" id="fSearch" type="search" placeholder="Поиск по названию, артикулу или ячейке" value="${esc(ui.q)}" aria-label="Поиск">
      <select class="field" id="fCat" aria-label="Категория"><option value="">Все категории</option>${CATEGORIES.map(c => `<option ${ui.cat === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
      <select class="field" id="fStatus" aria-label="Статус">
        ${[['', 'Любой статус'], ['need', 'Нужно пополнить'], ['ok', 'В наличии'], ['low', 'Заканчивается'], ['out', 'Нет на складе']].map(([v, l]) => `<option value="${v}" ${ui.status === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    <div class="panel" id="tableWrap"></div>`;
  renderStats();
  renderTable();
}

/* ---- Список документов ---- */
function renderDocs() {
  const list = store.docs
    .filter(d => !ui.docFilter || d.type === ui.docFilter)
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const rows = list.map(d => {
    const t = docTotals(d);
    const who = d.type === DocType.IN ? d.party : [d.reason, d.party].filter(Boolean).join(' · ');
    return `<tr class="clickable" data-action="open-doc" data-id="${d.id}">
      <td><button class="linkbtn" data-action="open-doc" data-id="${d.id}">${esc(d.number)}</button></td>
      <td>${DOC_TITLE[d.type]}</td>
      <td class="time">${fmtDate(d.date)}</td>
      <td>${esc(who || '—')}</td>
      <td class="num">${t.lines}</td>
      <td class="num">${fmt(t.qty)}</td>
      <td><span class="badge ${d.status}">${DOC_STATUS_LABEL[d.status]}</span></td></tr>`;
  }).join('');
  const tab = (v, l) => `<button class="${ui.docFilter === v ? 'on' : ''}" data-action="doc-filter" data-filter="${v}">${l}</button>`;
  $('#main').innerHTML = `
    <div class="head">
      <div><h1>Документы</h1><p class="sub">Приходные накладные и акты списания. Черновик ничего не меняет, пока его не проведут.</p></div>
      <div class="head-actions">
        <button class="btn primary" data-action="new-doc" data-type="in">Приходная накладная</button>
        <button class="btn primary" data-action="new-doc" data-type="out">Акт списания</button>
      </div>
    </div>
    <div class="toolbar"><div class="tabs">${tab('', 'Все')}${tab('in', 'Приходы')}${tab('out', 'Списания')}</div></div>
    <div class="panel">${list.length
      ? `<div class="scroll"><table><thead><tr><th>Номер</th><th>Документ</th><th>Дата</th><th>Контрагент / причина</th><th>Позиций</th><th>Количество</th><th>Статус</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : `<div class="empty"><b>Документов пока нет</b>Оформите приходную накладную, чтобы поставить товар на учёт.<br><button class="btn primary" data-action="new-doc" data-type="in">Приходная накладная</button></div>`}</div>`;
}

/* ---- Редактор документа ---- */
function partnerSelect(d, kind, label) {
  const list = store.partners.filter(p => p.kind === kind).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const empty = kind === 'supplier' ? 'Выберите поставщика' : 'Не выбран';
  return `<label class="fld"><span class="lt">${label}</span><select class="field" data-doc-field="partnerId"><option value="">${empty}</option>${list.map(p => `<option value="${p.id}" ${p.id === d.partnerId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>`;
}

function docFieldsHtml(d, ro) {
  const f = (label, html) => `<label class="fld"><span class="lt">${label}</span>${html}</label>`;
  const kv = (label, val) => `<div class="kv"><span class="k">${label}</span><span class="v">${esc(val || '—')}</span></div>`;
  const out = [];
  out.push(ro ? kv('Дата', fmtDate(d.date)) : f('Дата', `<input class="field" type="date" data-doc-field="date" value="${esc(d.date)}">`));
  if (d.type === DocType.IN) {
    out.push(ro ? kv('Поставщик', d.party) : partnerSelect(d, 'supplier', 'Поставщик'));
  } else {
    out.push(ro ? kv('Причина списания', d.reason) : f('Причина списания', `<select class="field" data-doc-field="reason"><option value="">Выберите причину</option>${REASONS.map(r => `<option ${d.reason === r ? 'selected' : ''}>${r}</option>`).join('')}</select>`));
    out.push(ro ? kv('Покупатель', d.party) : partnerSelect(d, 'buyer', 'Покупатель'));
    out.push(ro ? kv('Ответственный', d.person) : f('Ответственный', `<input class="field" data-doc-field="person" maxlength="60" autocomplete="off" placeholder="ФИО или смена" value="${esc(d.person)}">`));
  }
  out.push(ro ? kv('Комментарий', d.note) : f('Комментарий', `<input class="field" data-doc-field="note" maxlength="120" autocomplete="off" placeholder="Необязательно" value="${esc(d.note)}">`));
  return out.join('');
}

function docLinesHtml(d, ro) {
  const sorted = store.items.slice().sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const rows = d.lines.map((l, i) => {
    const it = store.items.find(x => x.id === l.itemId);
    const pick = ro
      ? `<div class="name">${esc(it ? it.name : 'Позиция удалена')}</div><div class="sku">${esc(it ? it.sku : '')}</div>`
      : `<select class="field cell" data-line="${i}" data-field="itemId" aria-label="Позиция в строке ${i + 1}"><option value="">Выберите позицию</option>${sorted.map(x => `<option value="${x.id}" ${x.id === l.itemId ? 'selected' : ''}>${esc(x.name)} · ${esc(x.sku)}</option>`).join('')}</select>`;
    const qty = ro
      ? `<span class="qty">${fmt(l.qty)}</span>`
      : `<input class="field cell qin" inputmode="numeric" autocomplete="off" data-line="${i}" data-field="qty" placeholder="0" value="${esc(l.qty)}" aria-label="Количество в строке ${i + 1}">`;
    const qn = parseIntStrict(l.qty);
    const over = !ro && d.type === DocType.OUT && it && !Number.isNaN(qn) && qn > it.qty;
    return `<tr class="${over ? 'over' : ''}">
      <td class="lno">${i + 1}</td>
      <td>${pick}</td>
      <td class="unit">${it ? esc(it.unit) : ''}</td>
      ${ro ? '' : `<td class="num">${it ? fmt(it.qty) : '—'}<span class="need">${over ? ' · не хватает ' + fmt(qn - it.qty) : ''}</span></td>`}
      <td style="text-align:right">${qty}</td>
      ${ro ? '' : `<td><button class="mini del" data-action="del-line" data-index="${i}" aria-label="Удалить строку ${i + 1}">✕</button></td>`}
    </tr>`;
  }).join('');
  const cols = ro ? 4 : 6;
  return `<div class="scroll"><table class="lines">
    <thead><tr><th>№</th><th>Позиция</th><th>Ед.</th>${ro ? '' : '<th>Сейчас на складе</th>'}<th style="text-align:right">Количество</th>${ro ? '' : '<th></th>'}</tr></thead>
    <tbody>${rows || `<tr><td colspan="${cols}" class="empty" style="padding:28px">В документе пока нет строк. Добавьте позицию.</td></tr>`}</tbody></table></div>`;
}

function renderDocTotals() {
  const t = docTotals(ui.doc);
  const el = $('#docTotals');
  if (el) el.innerHTML = `<div><b>${t.lines}</b><span>позиций</span></div><div><b>${fmt(t.qty)}</b><span>единиц всего</span></div>`;
}

function renderDoc() {
  const d = ui.doc;
  const ro = d.status !== DocStatus.DRAFT;
  const num = d.number ? '№ ' + d.number : '(новый)';
  let sub;
  if (d.status === DocStatus.DRAFT) sub = d.type === DocType.IN ? 'Черновик. Товар встанет на остаток после проведения.' : 'Черновик. Товар спишется с остатка после проведения.';
  else if (d.status === DocStatus.POSTED) sub = `Проведён ${fmtTime(d.postedAt)}. Чтобы исправить, нажмите «Редактировать»: остатки откатятся, а после правки документ нужно провести снова.`;
  else sub = 'Документ отменён, остатки возвращены. Его можно вернуть в черновик и исправить.';

  let actions = '';
  if (d.status === DocStatus.DRAFT) {
    actions = `
      ${d.id != null ? `<button class="btn danger ${ui.confirmDocDelete ? 'confirm' : ''}" data-action="delete-doc">${ui.confirmDocDelete ? 'Точно удалить?' : 'Удалить черновик'}</button>` : ''}
      <button class="btn" data-action="save-doc">Сохранить черновик</button>
      <button class="btn primary" data-action="post-doc">Провести документ</button>`;
  } else if (d.status === DocStatus.POSTED) {
    actions = `
      <button class="btn" data-action="print">Печать</button>
      <button class="btn danger ${ui.confirmCancel ? 'confirm' : ''}" data-action="cancel-doc">${ui.confirmCancel ? 'Точно отменить?' : 'Отменить документ'}</button>
      <button class="btn primary" data-action="edit-doc">${ui.confirmEdit ? 'Остатки откатятся. Править?' : 'Редактировать'}</button>`;
  } else {
    actions = `
      <button class="btn" data-action="print">Печать</button>
      <button class="btn primary" data-action="reopen-doc">Вернуть в черновик</button>`;
  }

  $('#main').innerHTML = `
    <button class="back no-print" data-action="back-docs">← К списку документов</button>
    <div class="head">
      <div><h1>${DOC_TITLE[d.type]} <span class="docno">${esc(num)}</span></h1><p class="sub">${sub}</p></div>
      <div class="head-actions no-print">${actions}</div>
    </div>
    <div class="paper">
      <div class="paper-head">
        <span class="t">${DOC_TITLE[d.type]} ${esc(num)} от ${fmtDate(d.date)}</span>
        <span class="badge ${d.status}">${DOC_STATUS_LABEL[d.status]}</span>
      </div>
      <div class="fields">${docFieldsHtml(d, ro)}</div>
      ${ro ? '' : `<div class="addline no-print" style="margin:-10px 0 20px"><button class="linkbtn unit" data-action="open-partner" data-kind="${d.type === DocType.IN ? 'supplier' : 'buyer'}">Нет контрагента в списке? Добавить ${d.type === DocType.IN ? 'поставщика' : 'покупателя'}</button></div>`}
      ${docLinesHtml(d, ro)}
      ${ro ? '' : `<div class="addline no-print">
        <button class="btn" data-action="add-line">Добавить строку</button>
        <button class="linkbtn unit" data-action="open-new">Нет нужной позиции? Создать в справочнике</button>
      </div>`}
      <div class="totals" id="docTotals"></div>
    </div>
    ${ui.docNotes.length ? `<div class="warnbox" role="status">Документ проведён. Обратите внимание на остатки:<ul>${ui.docNotes.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
    ${ui.docErrors.length ? `<div class="errlist" role="alert">Документ не проведён. Исправьте:<ul>${ui.docErrors.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}`;
  renderDocTotals();
}

/* ---- Журнал ---- */
function renderLog() {
  const rows = store.log.slice(0, 200).map(l => `<tr>
    <td class="time">${fmtTime(l.ts)}</td>
    <td>${l.docNumber ? esc(l.docNumber) : '—'}</td>
    <td><div class="name">${esc(l.name)}</div><div class="sku">${esc(l.sku)}</div></td>
    <td><span class="kind ${l.type}">${l.type === 'in' ? 'Приход' : 'Списание'}</span></td>
    <td><span class="delta ${l.type}">${l.type === 'in' ? '+' : '−'}${fmt(l.qty)}</span></td>
    <td>${fmt(l.balance)}</td>
    <td class="note">${esc(l.note || '—')}</td></tr>`).join('');
  $('#main').innerHTML = `
    <div class="head"><div><h1>Журнал операций</h1><p class="sub">Каждая строка проведённого документа записывается сюда. Показаны последние 200.</p></div></div>
    <div class="panel">${store.log.length
      ? `<div class="scroll"><table><thead><tr><th>Время</th><th>Документ</th><th>Позиция</th><th>Операция</th><th>Кол-во</th><th>Остаток после</th><th>Основание</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : `<div class="empty"><b>Операций пока нет</b>Проведите приходную накладную или акт списания.</div>`}</div>`;
}

function renderTests() {
  const res = runTests();
  const ok = res.filter(r => r.pass).length;
  const env = (navigator.userAgent || '').slice(0, 90);
  $('#main').innerHTML = `
    <div class="head">
      <div><h1>Проверка работы</h1><p class="sub">Тест-кейсы запускаются на копии демо-данных и не меняют ваш склад. Таблицу можно перенести в README.</p></div>
      <button class="btn primary" data-action="rerun">Запустить снова</button>
    </div>
    <div class="summary">
      <span class="pill ${ok === res.length ? 'ok' : 'bad'}">Пройдено ${ok} из ${res.length}</span>
      <span class="env">Дата: ${new Date().toLocaleString('ru-RU')} · Окружение: ${esc(env)}</span>
    </div>
    <div class="panel"><div class="scroll"><table><thead><tr><th>ID</th><th>Тип</th><th>Сценарий</th><th>Ожидаемо</th><th>Фактически</th><th>Статус</th></tr></thead><tbody>
      ${res.map(r => `<tr><td class="name">${r.id}</td><td>${r.kind}</td><td>${esc(r.scenario)}</td><td>${esc(r.expected)}</td><td>${esc(r.actual)}</td><td><span class="res ${r.pass ? 'PASS' : 'FAIL'}">${r.pass ? 'PASS' : 'FAIL'}</span></td></tr>`).join('')}
    </tbody></table></div></div>`;
}

/* =====================================================
   6. Диалоги и события
   ===================================================== */
function render() {
  renderNav();
  ({ stock: renderStock, docs: renderDocs, doc: renderDoc, partners: renderPartners, log: renderLog, tests: renderTests })[ui.view]();
}

function openNew() {
  $('#nCat').innerHTML = CATEGORIES.map(c => `<option>${c}</option>`).join('');
  $('#nUnit').innerHTML = UNITS.map(u => `<option>${u}</option>`).join('');
  ['nName', 'nSku', 'nLoc'].forEach(i => $('#' + i).value = '');
  $('#nMin').value = '5';
  clearNewErrors();
  $('#dlgNew').showModal();
  $('#nName').focus();
}

function clearNewErrors() {
  document.querySelectorAll('#dlgNew .err').forEach(e => e.textContent = '');
  document.querySelectorAll('#dlgNew .field').forEach(f => f.classList.remove('bad'));
}

const NEW_FIELD = { name: 'nName', sku: 'nSku', location: 'nLoc', category: 'nCat', unit: 'nUnit', min: 'nMin' };

function submitNew() {
  clearNewErrors();
  const data = {
    name: $('#nName').value, sku: $('#nSku').value, location: $('#nLoc').value,
    category: $('#nCat').value, unit: $('#nUnit').value, qty: '0', min: $('#nMin').value
  };
  const r = addItem(store, data);
  if (!r.ok) {
    for (const k of Object.keys(r.errors)) {
      const e = $('#err-' + k), f = $('#' + NEW_FIELD[k]);
      if (e) e.textContent = r.errors[k];
      if (f) f.classList.add('bad');
    }
    return;
  }
  save();
  $('#dlgNew').close();
  render();
  toast(`Добавлено в справочник: ${r.item.name}`);
}

const KIND_BADGE = { supplier: 'supplier', buyer: 'buyer' };

function filteredPartners() {
  const tokens = normalize(ui.partnerQ).split(' ').filter(Boolean);
  return store.partners
    .filter(p => (!ui.partnerFilter || p.kind === ui.partnerFilter) && tokens.every(t => normalize([p.name, p.bin, p.phone].join(' ')).includes(t)))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

function renderPartnerTable() {
  const wrap = $('#partnerTable');
  if (!wrap) return;
  if (!store.partners.length) {
    wrap.innerHTML = `<div class="empty"><b>Список контрагентов пуст</b>Добавьте поставщиков и покупателей, чтобы выбирать их в документах.<br><button class="btn primary" data-action="open-partner" data-kind="supplier">Новый контрагент</button></div>`;
    return;
  }
  const list = filteredPartners();
  if (!list.length) { wrap.innerHTML = `<div class="empty"><b>Ничего не найдено</b>Измените запрос или тип.</div>`; return; }
  const rows = list.map(p => {
    const n = partnerDocCount(store, p.id);
    const del = ui.pendingPartnerDelete === p.id;
    return `<tr>
      <td><div class="name">${esc(p.name)}</div><div class="sku">${p.bin ? 'БИН/ИИН ' + esc(p.bin) : 'БИН/ИИН не указан'}</div></td>
      <td><span class="badge ${p.kind}">${PARTNER_KIND[p.kind]}</span></td>
      <td>${esc(p.phone || '—')}</td>
      <td class="num">${n}</td>
      <td><div class="row-actions">
        <button class="mini" data-action="open-partner" data-id="${p.id}">Изменить</button>
        <button class="mini del ${del ? 'confirm' : ''}" data-action="delete-partner" data-id="${p.id}" aria-label="Удалить ${esc(p.name)}">${del ? 'Удалить?' : '✕'}</button>
      </div></td></tr>`;
  }).join('');
  wrap.innerHTML = `<div class="scroll"><table><thead><tr><th>Контрагент</th><th>Тип</th><th>Телефон</th><th>Документов</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderPartners() {
  const tab = (v, l) => `<button class="${ui.partnerFilter === v ? 'on' : ''}" data-action="partner-filter" data-filter="${v}">${l}</button>`;
  $('#main').innerHTML = `
    <div class="head">
      <div><h1>Контрагенты</h1><p class="sub">Поставщики выбираются в приходных накладных, покупатели — при отгрузке в актах списания.</p></div>
      <div class="head-actions">
        <button class="btn" data-action="open-partner" data-kind="buyer">Новый покупатель</button>
        <button class="btn primary" data-action="open-partner" data-kind="supplier">Новый поставщик</button>
      </div>
    </div>
    <div class="toolbar">
      <div class="tabs">${tab('', 'Все')}${tab('supplier', 'Поставщики')}${tab('buyer', 'Покупатели')}</div>
      <input class="field search" id="fPartnerSearch" type="search" placeholder="Поиск по названию, БИН или телефону" value="${esc(ui.partnerQ)}" aria-label="Поиск контрагента">
    </div>
    <div class="panel" id="partnerTable"></div>`;
  renderPartnerTable();
}

const PARTNER_FIELD = { name: 'pName', kind: 'pKind', bin: 'pBin', phone: 'pPhone' };

function clearPartnerErrors() {
  document.querySelectorAll('#dlgPartner .err').forEach(e => e.textContent = '');
  document.querySelectorAll('#dlgPartner .field').forEach(f => f.classList.remove('bad'));
}

function openPartner(id, kind) {
  const p = id != null ? store.partners.find(x => x.id === id) : null;
  ui.editPartnerId = p ? p.id : null;
  $('#pTitle').textContent = p ? 'Изменить контрагента' : (kind === 'buyer' ? 'Новый покупатель' : 'Новый поставщик');
  $('#pName').value = p ? p.name : '';
  $('#pKind').value = p ? p.kind : (kind || 'supplier');
  $('#pBin').value = p ? p.bin : '';
  $('#pPhone').value = p ? p.phone : '';
  $('#pSubmit').textContent = p ? 'Сохранить' : 'Добавить';
  clearPartnerErrors();
  $('#dlgPartner').showModal();
  $('#pName').focus();
}

function submitPartner() {
  clearPartnerErrors();
  const data = { name: $('#pName').value, kind: $('#pKind').value, bin: $('#pBin').value, phone: $('#pPhone').value };
  const editing = ui.editPartnerId != null;
  const r = editing ? updatePartner(store, ui.editPartnerId, data) : addPartner(store, data);
  if (!r.ok) {
    for (const k of Object.keys(r.errors)) {
      const e = $('#perr-' + k), f = $('#' + PARTNER_FIELD[k]);
      if (e) e.textContent = r.errors[k];
      if (f) f.classList.add('bad');
    }
    return;
  }
  if (!editing && ui.view === 'doc' && ui.doc && ui.doc.status === DocStatus.DRAFT) {
    const need = ui.doc.type === DocType.IN ? 'supplier' : 'buyer';
    if (r.partner.kind === need) { ui.doc.partnerId = r.partner.id; ui.doc.party = r.partner.name; }
  }
  save();
  $('#dlgPartner').close();
  render();
  toast(editing ? `Сохранено: ${r.partner.name}` : `Добавлен контрагент: ${r.partner.name}`);
}

function openDoc(doc) {
  ui.doc = clone(doc);
  ui.docErrors = [];
  ui.docNotes = [];
  ui.confirmDocDelete = false;
  ui.confirmCancel = false;
  ui.confirmEdit = false;
  ui.view = 'doc';
  render();
  window.scrollTo(0, 0);
}

function persistDraft() {
  const saved = saveDoc(store, ui.doc);
  ui.doc = clone(saved);
  save();
  return saved;
}

function resetConfirms(except) {
  let redraw = false;
  if (except !== 'delete-partner' && ui.pendingPartnerDelete !== null) { ui.pendingPartnerDelete = null; if (ui.view === 'partners') renderPartnerTable(); }
  if (except !== 'delete' && ui.pendingDelete !== null) { ui.pendingDelete = null; if (ui.view === 'stock') renderTable(); }
  if (except !== 'delete-doc' && ui.confirmDocDelete) { ui.confirmDocDelete = false; redraw = true; }
  if (except !== 'cancel-doc' && ui.confirmCancel) { ui.confirmCancel = false; redraw = true; }
  if (except !== 'edit-doc' && ui.confirmEdit) { ui.confirmEdit = false; redraw = true; }
  if (redraw && ui.view === 'doc') renderDoc();
}

document.addEventListener('click', e => {
  const navBtn = e.target.closest('[data-view]');
  if (navBtn) { ui.view = navBtn.dataset.view; ui.pendingDelete = null; ui.confirmDocDelete = false; ui.confirmCancel = false; ui.confirmEdit = false; render(); return; }

  const t = e.target.closest('[data-action]');
  if (!t) { resetConfirms(null); return; }
  const a = t.dataset.action;
  const id = Number(t.dataset.id);
  resetConfirms(a);

  switch (a) {
    case 'open-new': openNew(); break;
    case 'close-dialog': t.closest('dialog').close(); break;
    case 'new-submit': submitNew(); break;

    case 'sort':
      if (ui.sortKey === t.dataset.key) ui.sortDir *= -1; else { ui.sortKey = t.dataset.key; ui.sortDir = 1; }
      renderTable(); break;
    case 'filter-need': ui.status = ui.status === 'need' ? '' : 'need'; renderStock(); break;
    case 'reset-filters': ui.q = ''; ui.cat = ''; ui.status = ''; renderStock(); break;
    case 'delete': {
      if (ui.pendingDelete === id) {
        const it = store.items.find(i => i.id === id);
        const r = removeItem(store, id);
        ui.pendingDelete = null;
        if (r.ok) { save(); render(); toast(`Удалено: ${it ? it.name : 'позиция'}`); }
        else { renderTable(); toast(r.error, true); }
      } else { ui.pendingDelete = id; renderTable(); }
      break;
    }

    case 'new-doc':
      ui.doc = blankDoc(t.dataset.type, t.dataset.item ? Number(t.dataset.item) : null);
      ui.docErrors = []; ui.docNotes = []; ui.confirmDocDelete = false; ui.confirmCancel = false;
      ui.view = 'doc'; render(); window.scrollTo(0, 0); break;
    case 'open-doc': {
      const d = store.docs.find(x => x.id === id);
      if (d) openDoc(d);
      break;
    }
    case 'doc-filter': ui.docFilter = t.dataset.filter; renderDocs(); break;
    case 'back-docs': ui.view = 'docs'; ui.docNotes = []; render(); break;
    case 'add-line': ui.doc.lines.push({ itemId: '', qty: '' }); renderDoc(); break;
    case 'del-line': ui.doc.lines.splice(Number(t.dataset.index), 1); renderDoc(); break;
    case 'save-doc': {
      const saved = persistDraft();
      ui.docErrors = [];
      render();
      toast(`Черновик сохранён: ${saved.number}`);
      break;
    }
    case 'post-doc': {
      const saved = persistDraft();
      const r = postDoc(store, saved.id);
      if (!r.ok) { ui.docErrors = r.errors; renderNav(); renderDoc(); toast('Документ не проведён — исправьте ошибки', true); break; }
      save();
      ui.doc = clone(r.doc);
      ui.docErrors = [];
      ui.docNotes = r.warnings || [];
      render();
      window.scrollTo(0, 0);
      toast(`${DOC_TITLE[r.doc.type]} ${r.doc.number} проведён`);
      break;
    }
    case 'delete-doc': {
      if (ui.doc.id == null) { ui.view = 'docs'; render(); break; }
      if (!ui.confirmDocDelete) { ui.confirmDocDelete = true; renderDoc(); break; }
      const num = ui.doc.number;
      deleteDoc(store, ui.doc.id);
      save(); ui.confirmDocDelete = false; ui.view = 'docs'; render();
      toast(`Черновик ${num} удалён`);
      break;
    }
    case 'cancel-doc': {
      if (!ui.confirmCancel) { ui.confirmCancel = true; renderDoc(); break; }
      ui.confirmCancel = false;
      const r = cancelDoc(store, ui.doc.id);
      if (!r.ok) { ui.docErrors = r.errors; renderDoc(); toast('Документ отменить нельзя', true); break; }
      save();
      ui.doc = clone(r.doc);
      ui.docErrors = [];
      render();
      toast(`Документ ${r.doc.number} отменён, остатки возвращены`);
      break;
    }
    case 'edit-doc': {
      if (!ui.confirmEdit) { ui.confirmEdit = true; renderDoc(); break; }
      ui.confirmEdit = false;
      const r = unpostDoc(store, ui.doc.id);
      if (!r.ok) { ui.docErrors = r.errors; renderDoc(); toast('Этот документ сейчас изменить нельзя', true); break; }
      save();
      ui.doc = clone(r.doc);
      ui.docErrors = [];
      render();
      window.scrollTo(0, 0);
      toast(`${r.doc.number} открыт для правки, остатки откатились`);
      break;
    }
    case 'reopen-doc': {
      const r = reopenDoc(store, ui.doc.id);
      if (!r.ok) { toast(r.errors[0], true); break; }
      save();
      ui.doc = clone(r.doc);
      ui.docErrors = [];
      render();
      toast(`${r.doc.number} возвращён в черновик`);
      break;
    }
    case 'print': try { window.print(); } catch (err) { toast('Печать недоступна в этом окне', true); } break;

    case 'open-partner': openPartner(t.dataset.id ? id : null, t.dataset.kind); break;
    case 'partner-submit': submitPartner(); break;
    case 'partner-filter': ui.partnerFilter = t.dataset.filter; renderPartners(); break;
    case 'delete-partner': {
      if (ui.pendingPartnerDelete === id) {
        const pr = store.partners.find(x => x.id === id);
        const r = removePartner(store, id);
        ui.pendingPartnerDelete = null;
        if (r.ok) { save(); render(); toast(`Удалён контрагент: ${pr ? pr.name : ''}`); }
        else { renderPartnerTable(); toast(r.error, true); }
      } else { ui.pendingPartnerDelete = id; renderPartnerTable(); }
      break;
    }
    case 'rerun': renderTests(); toast('Тесты выполнены заново'); break;
    case 'reset-demo':
      store = makeSeedStore(true); save(); ui.q = ''; ui.cat = ''; ui.status = ''; ui.view = 'stock'; render(); toast('Демо-данные восстановлены'); break;
  }
});

document.addEventListener('input', e => {
  const el = e.target;
  if (el.id === 'fSearch') { ui.q = el.value; renderTable(); return; }
  if (el.id === 'fPartnerSearch') { ui.partnerQ = el.value; renderPartnerTable(); return; }
  if (ui.view !== 'doc' || !ui.doc || ui.doc.status !== DocStatus.DRAFT) return;
  if (el.dataset.docField === 'partnerId') return;
  if (el.dataset.docField) { ui.doc[el.dataset.docField] = el.value; }
  else if (el.dataset.line !== undefined && el.dataset.field === 'qty') {
    const ln = ui.doc.lines[Number(el.dataset.line)];
    ln.qty = el.value;
    renderDocTotals();
    const it = store.items.find(x => x.id === ln.itemId);
    const q = parseIntStrict(el.value);
    const over = ui.doc.type === DocType.OUT && !!it && !Number.isNaN(q) && q > it.qty;
    const row = el.closest('tr');
    row.classList.toggle('over', over);
    const need = row.querySelector('.need');
    if (need) need.textContent = over ? ' · не хватает ' + fmt(q - it.qty) : '';
  }
});

document.addEventListener('change', e => {
  const el = e.target;
  if (el.id === 'fCat') { ui.cat = el.value; renderTable(); return; }
  if (el.id === 'fStatus') { ui.status = el.value; renderTable(); return; }
  if (ui.view !== 'doc' || !ui.doc || ui.doc.status !== DocStatus.DRAFT) return;
  if (el.dataset.docField === 'partnerId') {
    ui.doc.partnerId = el.value === '' ? null : Number(el.value);
    const pr = store.partners.find(x => x.id === ui.doc.partnerId);
    ui.doc.party = pr ? pr.name : '';
  } else if (el.dataset.docField) ui.doc[el.dataset.docField] = el.value;
  else if (el.dataset.line !== undefined && el.dataset.field === 'itemId') {
    ui.doc.lines[Number(el.dataset.line)].itemId = el.value === '' ? '' : Number(el.value);
    renderDoc();
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.closest('#dlgNew')) { e.preventDefault(); submitNew(); }
  if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.closest('#dlgPartner')) { e.preventDefault(); submitPartner(); }
});

render();
