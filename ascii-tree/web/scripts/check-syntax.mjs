// index.html 의 인라인 <script> 문법을 브라우저 없이 먼저 검사한다.
// 문법 오류가 있으면 브라우저 테스트가 30초 타임아웃으로 줄줄이 실패해 원인을 가리기 때문이다.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = process.env.XMAS_HTML || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.html');
const html = readFileSync(file, 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.error('인라인 <script> 를 찾지 못함: ' + file); process.exit(1); }
const dir = mkdtempSync(path.join(tmpdir(), 'xmas-syntax-'));
const js = path.join(dir, 'inline.js');
writeFileSync(js, m[1]);
const r = spawnSync(process.execPath, ['--check', js], { encoding: 'utf8' });
if (r.status !== 0) { console.error('문법 오류:\n' + r.stderr); process.exit(1); }
console.log('인라인 스크립트 문법 OK');
