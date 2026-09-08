#!/usr/bin/env python3
"""Render this report's Markdown subset into a standalone, shareable page."""
import html
import re
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
slug = 'telepathy-labs-2026-09-08'
out = root / 'artifacts/reports' / slug
out.mkdir(exist_ok=True)
source = root / 'artifacts/reports/2026-09-08-telepathy-labs-technical-report.md'
url = f'https://labs.intuitxn.com/reports/{slug}/'
title = 'Telepathy & Intuitxn Labs: what we have built'
description = 'Technical report: architecture, working agent execution, shipped foundations, live verification, and what remains before a shared production workspace.'

def inline(text):
    text = html.escape(text)
    text = re.sub(r'`([^`]+)`', r'<code>\1</code>', text)
    text = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', text)
    return re.sub(r'\[([^\]]+)\]\((https?://[^)]+)\)', r'<a href="\2">\1</a>', text)

body = []
paragraph = []
listing = None
code = None

def flush():
    if paragraph:
        body.append('<p>' + inline(' '.join(paragraph)) + '</p>')
        paragraph.clear()

for line in source.read_text().splitlines():
    if line.startswith('```'):
        flush()
        if code is None:
            code = []
        else:
            body.append('<pre><code>' + html.escape('\n'.join(code)) + '</code></pre>')
            code = None
        continue
    if code is not None:
        code.append(line)
        continue
    item = re.match(r'^(?:- |\d+\. )(.+)', line)
    if not item and listing:
        body.append(f'</{listing}>')
        listing = None
    if not line.strip():
        flush()
        continue
    heading = re.match(r'^(#{1,3}) (.+)', line)
    if heading:
        flush()
        level = len(heading[1])
        body.append(f'<h{level}>' + inline(heading[2]) + f'</h{level}>')
    elif item:
        flush()
        tag = 'ul' if line.startswith('- ') else 'ol'
        if listing != tag:
            if listing:
                body.append(f'</{listing}>')
            listing = tag
            body.append(f'<{tag}>')
        body.append('<li>' + inline(item[1]) + '</li>')
    else:
        paragraph.append(line)
flush()
if listing:
    body.append(f'</{listing}>')
assert code is None

page = '''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>__TITLE__</title><meta name="description" content="__DESC__">
<link rel="canonical" href="__URL__">
<meta property="og:type" content="article"><meta property="og:site_name" content="Intuitxn Reports">
<meta property="og:title" content="__TITLE__"><meta property="og:description" content="__DESC__">
<meta property="og:url" content="__URL__"><meta property="og:image" content="__URL__preview.png">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Telepathy and Intuitxn Labs technical report, 8 September 2026">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="__TITLE__">
<meta name="twitter:description" content="__DESC__"><meta name="twitter:image" content="__URL__preview.png">
<style>
:root{color-scheme:light;--paper:#f2eee6;--ink:#26231f;--accent:#bd3b22}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.75 system-ui,-apple-system,sans-serif}
header,main,footer{max-width:860px;margin:auto;padding:32px 28px}header{border-bottom:1px solid #d7cec0;display:flex;justify-content:space-between;gap:20px;font-size:14px}header a{font-weight:650}main{padding-top:12px;padding-bottom:56px}
h1,h2,h3{line-height:1.2;text-wrap:balance}h1{font:500 clamp(38px,6vw,60px)/1.1 Georgia,serif;letter-spacing:-1.8px;margin:36px 0 24px}h2{font:500 31px/1.2 Georgia,serif;margin:48px 0 16px;padding-top:20px;border-top:1px solid #d7cec0}h3{font-size:20px;margin-top:30px}p{margin:16px 0}a{color:#902a18;text-underline-offset:4px}a:hover{color:var(--accent)}li{margin:10px 0}code{font:0.86em/1.7 ui-monospace,monospace;background:#e9e3d8;border-radius:4px;padding:2px 5px;overflow-wrap:anywhere}pre{background:#26231f;color:#f2eee6;padding:24px;border-radius:12px;overflow:auto;font-size:14px}pre code{padding:0;background:none;color:inherit;white-space:pre;overflow-wrap:normal}footer{border-top:1px solid #d7cec0;color:#625c54;font-size:14px}a:focus-visible{outline:3px solid var(--accent);outline-offset:5px}
@media(max-width:500px){body{font-size:16px}header,main,footer{padding-left:20px;padding-right:20px}h1{letter-spacing:-1px}pre{padding:16px}}
@media print{body{background:white}header,footer{display:none}main{max-width:none}h2,h3{break-after:avoid}pre{white-space:pre-wrap}}
</style></head><body><header><a href="https://labs.intuitxn.com/">intuitxn / reports</a><a href="report.md" download>Download Markdown</a></header><main>__BODY__</main><footer>Technical report · 8 September 2026 · Prepared by Codex and shared at Shubham’s request.<br>This report describes the verified release boundary; Telepathy’s web interface remains a browser-local alpha.</footer></body></html>'''
for key, value in {'TITLE':html.escape(title),'DESC':html.escape(description),'URL':url,'BODY':'\n'.join(body)}.items():
    page = page.replace('__'+key+'__', value)
(out/'index.html').write_text(page)
(out/'report.md').write_bytes(source.read_bytes())
# A text-only social preview card; the report is readable without scripts or fonts.
image = Image.new('RGB', (1200, 630), '#f2eee6')
draw = ImageDraw.Draw(image)
def font(size, bold=False):
    return ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial'+(' Bold' if bold else '')+'.ttf',size)
draw.rectangle((0,0,15,630),fill='#bd3b22')
draw.text((70,54),'INTUITXN / TECHNICAL REPORT',font=font(24,True),fill='#902a18')
draw.text((70,142),'Telepathy &',font=font(70,True),fill='#26231f')
draw.text((70,224),'Intuitxn Labs',font=font(70,True),fill='#26231f')
draw.text((73,345),'What we have built. What works. What is next.',font=font(30),fill='#625c54')
draw.line((70,474,1130,474),fill='#d7cec0',width=2)
draw.text((70,522),'ARCHITECTURE  /  VERIFICATION  /  LIVE USE',font=font(22,True),fill='#26231f')
draw.text((930,522),'08 SEP 2026',font=font(22),fill='#625c54')
image.save(out/'preview.png')
print(out)
