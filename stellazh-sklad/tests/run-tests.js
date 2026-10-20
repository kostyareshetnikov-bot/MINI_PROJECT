'use strict';
// Запуск: node tests/run-tests.js   (или npm test)
// Загружает src/js/logic.js и tests/test-cases.js в изолированный контекст, выполняет тест-кейсы,
// печатает таблицу и записывает протокол в tests/test-report.md.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const os = require('os');

const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const ctx = vm.createContext({ console });
vm.runInContext(read('../src/js/logic.js') + '\n' + read('test-cases.js') + '\nthis.__results = runTests();', ctx);
const results = ctx.__results;

const pad = (s, n) => String(s).padEnd(n);
console.log('\nПротокол тестирования — Стеллаж\n');
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${pad(r.id, 5)} ${pad(r.kind, 13)} ${r.scenario}`);
  if (!r.pass) console.log(`      ожидалось: ${r.expected}\n      получено:  ${r.actual}`);
}
const ok = results.filter(r => r.pass).length;
console.log(`\nИтого: ${ok} из ${results.length} PASS\n`);

const d = new Date();
const stamp = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
const esc = s => String(s).replace(/\|/g, '\\|');
let md = `# Протокол тестирования\n\n- Дата: ${stamp}\n- Окружение: Node.js ${process.version}, ${os.type()} ${os.release()}\n- Команда: \`npm test\`\n- Результат: **${ok} из ${results.length} PASS**\n\n`;
md += '| ID | Тип | Сценарий | Ожидаемо | Фактически | Статус |\n|---|---|---|---|---|---|\n';
for (const r of results) md += `| ${r.id} | ${r.kind} | ${esc(r.scenario)} | ${esc(r.expected)} | ${esc(r.actual)} | ${r.pass ? 'PASS' : 'FAIL'} |\n`;
fs.writeFileSync(path.join(__dirname, 'test-report.md'), md, 'utf8');
process.exit(ok === results.length ? 0 : 1);
