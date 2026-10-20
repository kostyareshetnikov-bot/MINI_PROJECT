"""Собирает одиночный HTML-файл (CSS и JS внутри) для публикации: python3 tools/bundle.py"""
import os, re
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rd = lambda p: open(os.path.join(root, p), encoding='utf-8').read()
html = rd('src/index.html')
html = html.replace('<link rel="stylesheet" href="css/styles.css">', '<style>\n' + rd('src/css/styles.css') + '</style>')
def inline(m):
    src = m.group(1)
    path = os.path.normpath(os.path.join('src', src))
    return '<script>\n' + rd(path) + '</script>'
html = re.sub(r'<script src="([^"]+)"></script>', inline, html)
os.makedirs(os.path.join(root, 'dist'), exist_ok=True)
out = os.path.join(root, 'dist', 'stellazh-sklad.html')
open(out, 'w', encoding='utf-8').write(html)
print('Готово:', out)
