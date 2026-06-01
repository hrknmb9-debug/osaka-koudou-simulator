#!/usr/bin/env node
/** X共有ロジックの静的精査 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const js = readFileSync(join(root, 'scripts/time-attack.js'), 'utf8');
const html = readFileSync(join(root, 'index.html'), 'utf8');

const fail = [];
const pass = (m) => console.log(`  ✓ ${m}`);

const SHARE_APP_URL = 'https://osaka-koudou-simulator.vercel.app/';
const COURSE_GROUP_LABELS = {
  shigisan: '信貴山',
  saruyama: '猿山',
  hanna: '阪奈',
  kanjo: '阪神環状',
  test: 'テスト'
};

function buildShareText(courseName, time, gateName) {
  return (
    '【大阪公道シミュレーター】タイムアタック計測完了！\n\n' +
    `▶︎ コース: ${courseName}\n` +
    `⏱️ タイム: ${time}\n` +
    `📍 地点: ${gateName}\n\n` +
    '#大阪公道シミュレーター #タイムアタック\n'
  );
}

function xIntentTweetUrl(text) {
  const params = new URLSearchParams();
  params.set('text', text.trim());
  params.set('url', SHARE_APP_URL);
  return `https://x.com/intent/tweet?${params.toString()}`;
}

console.log('══ X共有 精査 ══\n');

if (!js.includes('x.com/intent/tweet')) fail.push('intent/tweet URL 未使用');
if (/intent\/post\?/.test(js)) fail.push('intent/post URL が残存（iOSループ危険）');
else pass('intent/tweet のみ（post URL なし）');

if (!js.includes('data-share-id')) fail.push('data-share-id ボタン欠落');
else pass('記録行に data-share-id');

if (!js.includes('shareRecordToX')) fail.push('shareRecordToX 欠落');
if (!js.includes('global.shareToX')) fail.push('global.shareToX 未公開');
else pass('shareRecordToX / shareToX 定義');

if (!html.includes('attack-record-share')) fail.push('CSS attack-record-share 欠落');
else pass('index.html に共有ボタン用スタイル');

if (!html.includes('scripts/time-attack.js')) fail.push('time-attack.js 未読込');
else pass('time-attack.js 読込');

if (!js.includes('isMobileOrStandalone')) fail.push('isMobileOrStandalone 欠落');
else pass('モバイル/PWA 判定あり');

for (const [g, label, time, test] of [
  ['kanjo', '阪神環状 · 外回り', '02:59.042', false],
  ['shigisan', '信貴山 · 十三峠（上り）', '03:17.000', false],
  ['test', 'テストゲート（現地確認）', '00:45.123', true]
]) {
  const courseName = COURSE_GROUP_LABELS[g] || g;
  let gateName = label;
  if (test) gateName += ' (現地確認)';
  const url = xIntentTweetUrl(buildShareText(courseName, time, gateName));
  if (url.length > 2048) fail.push(`${g}: URL長 ${url.length} > 2048`);
  try {
    const u = new URL(url);
    if (!u.searchParams.get('text')) fail.push(`${g}: text パラメータなし`);
    if (u.searchParams.get('url') !== SHARE_APP_URL) fail.push(`${g}: url パラメータ不一致`);
  } catch {
    fail.push(`${g}: 不正URL`);
  }
}
pass('URL生成・長さ・パラメータ（3コース）');

const sample = xIntentTweetUrl(buildShareText('阪神環状', '02:59.042', '阪神環状 · 外回り'));
console.log('\n── 生成URL例 ──');
console.log(sample.slice(0, 120) + '...');
console.log(`長さ: ${sample.length} 文字\n`);

if (fail.length) {
  console.log('── 不合格 ──');
  fail.forEach((f) => console.log(`  ✗ ${f}`));
  process.exit(1);
}
console.log('X共有 静的精査: 合格\n');
