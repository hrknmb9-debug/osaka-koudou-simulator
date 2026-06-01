/**
 * GPSベクトル交差タイムアタック（スタート／ゴールゲート通過検知）
 */
(function (global) {
  'use strict';

  const LOG_KEY = 'osaka_kodo_attack_log_v2';
  const MAX_LOG = 200;
  const SHARE_APP_URL = 'https://osaka-koudou-simulator.vercel.app/';

  function confirmTwice(first, second) {
    if (typeof global.confirm !== 'function') return true;
    if (!global.confirm(first)) return false;
    if (!global.confirm(second)) return false;
    return true;
  }

  /** タイムアタック用チャイム（Web Audio・外部ファイル不要） */
  const RecordChime = (function () {
    let ctx = null;
    const START_NOTES = [{ f: 523.25, at: 0 }, { f: 783.99, at: 0.07 }];
    const FINISH_NOTES = [{ f: 880, at: 0 }, { f: 1174.66, at: 0.1 }];

    function getCtx() {
      if (ctx) return ctx;
      const Ctx = global.AudioContext || global.webkitAudioContext;
      if (!Ctx) return null;
      try {
        ctx = new Ctx();
      } catch (_) {
        return null;
      }
      return ctx;
    }

    function shouldPlay() {
      return !global.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    }

    function playNotes(c, t0, notes, peak, decay) {
      notes.forEach(({ f, at }) => {
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = 'sine';
        osc.frequency.value = f;
        const t = t0 + at;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(peak, t + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
        osc.connect(gain);
        gain.connect(c.destination);
        osc.start(t);
        osc.stop(t + decay + 0.04);
      });
    }

    function run(notes, peak, decay) {
      if (!shouldPlay()) return;
      const c = getCtx();
      if (!c) return;
      const exec = () => playNotes(c, c.currentTime, notes, peak, decay);
      if (c.state === 'suspended') {
        c.resume().then(exec).catch(() => {});
      } else {
        exec();
      }
    }

    function unlock() {
      const c = getCtx();
      if (!c) return Promise.resolve();
      const resume = c.state === 'suspended' ? c.resume() : Promise.resolve();
      return resume.then(() => {
        const o = c.createOscillator();
        const g = c.createGain();
        g.gain.value = 0.0001;
        o.connect(g);
        g.connect(c.destination);
        const t = c.currentTime;
        o.start(t);
        o.stop(t + 0.02);
      }).catch(() => {});
    }

    return {
      unlock,
      playStart: () => run(START_NOTES, 0.2, 0.2),
      playFinish: () => run(FINISH_NOTES, 0.22, 0.32)
    };
  })();

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

  function isMobileOrStandalone() {
    return (
      /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '') ||
      window.navigator.standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches ||
      ((navigator.maxTouchPoints || 0) > 1 && global.innerWidth < 1024)
    );
  }

  function isInAppBrowser() {
    return /Line\/|FBAN|FBAV|Twitter|MicroMessenger|GSA\//i.test(navigator.userAgent || '');
  }

  function getInstagramLaunchHref() {
    if (isAndroid()) {
      return (
        'intent://story-camera/#Intent;' +
        'package=com.instagram.android;scheme=instagram;end'
      );
    }
    return 'instagram://story-camera';
  }

  function isIOS() {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  }

  function isAndroid() {
    return /Android/i.test(navigator.userAgent || '');
  }

  /** 記録保存時に先読み — IG タップ後すぐ保存・起動できるように */
  const storyBlobCache = new Map();
  const STORY_CACHE_MAX = 30;
  /** 画像レイアウト変更時に increment（古いキャッシュを無効化） */
  const STORY_IMG_VER = 15;
  const STORY_FONT_LINK_ID = 'story-noto-sans-jp-css';
  /** Canvas は先頭フォントのみ使うため JetBrains を日本語に使わない */
  const FONT_JP =
    '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic UI", sans-serif';
  const FONT_LATIN = '"JetBrains Mono", ui-monospace, monospace';
  const FONT_TIME = 'Orbitron, ui-monospace, monospace';
  let storyFontReadyPromise = null;

  function ensureStoryCanvasFonts() {
    if (storyFontReadyPromise) return storyFontReadyPromise;
    storyFontReadyPromise = (async () => {
      const doc = global.document;
      if (!doc) return;
      if (!doc.getElementById(STORY_FONT_LINK_ID)) {
        const link = doc.createElement('link');
        link.id = STORY_FONT_LINK_ID;
        link.rel = 'stylesheet';
        link.href =
          'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@500;700&display=swap';
        doc.head.appendChild(link);
        await new Promise((resolve) => {
          link.addEventListener('load', resolve, { once: true });
          link.addEventListener('error', resolve, { once: true });
        });
      }
      if (!doc.fonts?.load) return;
      try {
        await Promise.all([
          doc.fonts.load(`700 42px ${FONT_JP}`),
          doc.fonts.load(`700 30px ${FONT_JP}`),
          doc.fonts.load(`500 22px ${FONT_JP}`),
          doc.fonts.load(`900 108px ${FONT_TIME}`)
        ]);
        await doc.fonts.ready;
      } catch (_) {}
    })();
    return storyFontReadyPromise;
  }

  function storyCacheKey(entryId) {
    return `${STORY_IMG_VER}:${entryId}`;
  }

  function cacheStoryBlobForEntry(entry) {
    const meta = entryShareMeta(entry);
    buildStoryImageBlob(meta).then((blob) => {
      if (!blob) return;
      storyBlobCache.set(storyCacheKey(entry.id), blob);
      if (storyBlobCache.size > STORY_CACHE_MAX) {
        const oldest = storyBlobCache.keys().next().value;
        storyBlobCache.delete(oldest);
      }
    });
  }

  /** iOS: 標準クリップボード（Instagram が参照する場合あり） */
  async function copyImageToClipboard(blob) {
    if (!global.navigator.clipboard?.write || !global.ClipboardItem) return false;
    try {
      await global.navigator.clipboard.write([
        new global.ClipboardItem({ 'image/png': blob })
      ]);
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * X共有と同じ — location.href（タップ直後の同期呼び出しが必須）
   * ※ download より先に呼ぶ。後続処理は setTimeout で遅延すること
   */
  function launchInstagramAppNow() {
    if (!isMobileOrStandalone()) return false;
    if (isInAppBrowser()) {
      global.alert(
        'Instagramを開くには Safari でこのページを開いてください。\n' +
          '（LINE・Xなどのアプリ内ブラウザでは起動できない場合があります）'
      );
      return false;
    }
    const url = getInstagramLaunchHref();
    try {
      global.window.location.href = url;
      return true;
    } catch (_) {}
    try {
      const a = global.document.createElement('a');
      a.href = url;
      a.style.display = 'none';
      global.document.body.appendChild(a);
      a.click();
      a.remove();
      return true;
    } catch (_) {
      return false;
    }
  }

  /** X 投稿画面へ（intent/tweet — モバイルでは X アプリが開く） */
  function xIntentTweetUrl(text) {
    const params = new URLSearchParams();
    params.set('text', text.trim());
    params.set('url', SHARE_APP_URL);
    return `https://x.com/intent/tweet?${params.toString()}`;
  }

  /**
   * ワンタップで X へ — スマホ/PWA は同一タブ遷移でアプリ Handoff、PC は別タブ
   * ※ intent/post は iOS でループするため tweet を使用
   */
  function shareToX(courseName, time, gateName) {
    const text = buildShareText(courseName, time, gateName);
    const intentUrl = xIntentTweetUrl(text);

    if (isMobileOrStandalone()) {
      window.location.href = intentUrl;
      return;
    }

    const a = document.createElement('a');
    a.href = intentUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  global.shareToX = shareToX;

  function courseDirLabel(entry) {
    if (entry.testMode) return 'テスト';
    if (entry.courseDir === 'lap') return '周回';
    if (entry.courseDir === 'down') return '下り';
    if (entry.courseDir === 'up') return '上り';
    return '';
  }

  function inferCourseGroupFromLabel(label) {
    const t = String(label || '');
    if (/信貴|十三|水無瀬/.test(t)) return 'shigisan';
    if (/猿山/.test(t)) return 'saruyama';
    if (/阪奈|国道308|308/.test(t)) return 'hanna';
    if (/環状|甲子園/.test(t)) return 'kanjo';
    if (/テスト|現地/.test(t)) return 'test';
    return '';
  }

  function inferCourseDirFromLabel(label) {
    const t = String(label || '');
    if (/下り/.test(t)) return 'down';
    if (/上り/.test(t)) return 'up';
    if (/周回|ラップ|外回り/.test(t)) return 'lap';
    return '';
  }

  function entryShareMeta(entry) {
    const routeLabel = (entry.label || '—').trim();
    let courseGroup = entry.courseGroup || inferCourseGroupFromLabel(routeLabel);
    let courseDir = entry.courseDir || inferCourseDirFromLabel(routeLabel);
    if (entry.testMode) courseGroup = 'test';
    let courseName = COURSE_GROUP_LABELS[courseGroup] || courseGroup || '';
    if (!courseName && routeLabel && routeLabel !== '—') {
      const head = routeLabel.split(/[·・]/)[0].trim();
      if (head) courseName = head;
    }
    if (!courseName) courseName = '—';
    const dirLabel = courseDirLabel(entry);
    let gateName = routeLabel;
    if (entry.testMode) gateName += ' (現地確認)';
    return {
      courseName,
      routeLabel,
      dirLabel,
      time: entry.time || '—',
      gateName,
      courseGroup,
      courseDir,
      testMode: !!entry.testMode
    };
  }

  function wrapLines(ctx, text, maxWidth) {
    const lines = [];
    let line = '';
    for (const ch of String(text)) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = ch;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : ['—'];
  }

  function parseFontPx(font) {
    const m = /(\d+(?:\.\d+)?)\s*px/.exec(font || '');
    return m ? Number(m[1]) : 16;
  }

  /** 日本語フォントの実際の行高（ベースライン重なり防止） */
  function lineHeightForFont(ctx, font, extraGap) {
    const px = parseFontPx(font);
    ctx.font = font;
    const m = ctx.measureText('信貴山Ag');
    const ascent = m.actualBoundingBoxAscent > 0 ? m.actualBoundingBoxAscent : px * 0.92;
    const descent = m.actualBoundingBoxDescent > 0 ? m.actualBoundingBoxDescent : px * 0.28;
    const gap = extraGap != null ? extraGap : Math.max(10, Math.round(px * 0.2));
    return Math.ceil(ascent + descent + gap);
  }

  function storyCourseDisplayTitle(courseName, routeLabel) {
    const name = (courseName || '—').trim() || '—';
    const route = (routeLabel || '').trim();
    if (!route || route === '—' || route === name) return name;
    if (route.includes(name) && route.length > name.length + 1) return route;
    return name;
  }

  function storyCourseDisplaySubtitle(courseName, routeLabel, dirLabel) {
    const route = (routeLabel || '').trim();
    const name = (courseName || '—').trim() || '—';
    if (!route || route === '—') return '';
    if (route.includes(name) && route.length > name.length + 1) return '';
    return storyCourseSubtitle(courseName, routeLabel, dirLabel);
  }

  /** 幅に収まるまで縮小、それでも無理なら最大2行 */
  function fitStoryCourseTitle(ctx, text, maxW, maxPx, minPx) {
    let size = maxPx;
    while (size >= minPx) {
      const font = `700 ${size}px ${FONT_JP}`;
      ctx.font = font;
      if (ctx.measureText(text).width <= maxW) {
        return { font, lines: [text], lineH: lineHeightForFont(ctx, font) };
      }
      size -= 2;
    }
    const font = `700 ${minPx}px ${FONT_JP}`;
    ctx.font = font;
    const lines = wrapLines(ctx, text, maxW).slice(0, 2);
    return { font, lines, lineH: lineHeightForFont(ctx, font) };
  }

  function routeLabelShowsDir(routeLabel, dirLabel) {
    if (!dirLabel || dirLabel === 'テスト' || dirLabel === '周回') return true;
    if (dirLabel === '上り') return /上り/.test(routeLabel);
    if (dirLabel === '下り') return /下り/.test(routeLabel);
    return false;
  }

  function drawCenteredLines(ctx, lines, y0, lineHeight, font, color, centerX) {
    ctx.fillStyle = color;
    ctx.font = font;
    ctx.textAlign = 'center';
    lines.forEach((ln, i) => {
      ctx.fillText(ln, centerX, y0 + i * lineHeight);
    });
  }

  function storyRoundRect(ctx, x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + w - rad, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
    ctx.lineTo(x + w, y + h - rad);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
    ctx.lineTo(x + rad, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
    ctx.lineTo(x, y + rad);
    ctx.quadraticCurveTo(x, y, x + rad, y);
    ctx.closePath();
  }

  function drawStoryBackground(ctx, W, H) {
    const bg = ctx.createLinearGradient(0, 0, W * 0.2, H);
    bg.addColorStop(0, '#0c1420');
    bg.addColorStop(0.5, '#05080e');
    bg.addColorStop(1, '#0a1018');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const glow = (cx, cy, r, color) => {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, color);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    };
    glow(W * 0.12, H * 0.18, W * 0.55, 'rgba(0, 240, 255, 0.14)');
    glow(W * 0.88, H * 0.42, W * 0.45, 'rgba(255, 60, 120, 0.1)');
    glow(W * 0.5, H * 0.92, W * 0.6, 'rgba(0, 180, 255, 0.08)');

    ctx.strokeStyle = 'rgba(0, 240, 255, 0.04)';
    ctx.lineWidth = 1;
    for (let y = 0; y < H; y += 48) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    for (let x = 0; x < W; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }

    const frame = 56;
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.22)';
    ctx.lineWidth = 1;
    storyRoundRect(ctx, frame, frame, W - frame * 2, H - frame * 2, 20);
    ctx.stroke();
    const accent = (fx, fy, len, hdx, hdy) => {
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 3;
      ctx.shadowColor = 'rgba(0, 240, 255, 0.8)';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + hdx * len, fy + hdy * len);
      ctx.stroke();
      ctx.shadowBlur = 0;
    };
    const m = frame + 8;
    accent(m, m, 48, 1, 0);
    accent(m, m, 48, 0, 1);
    accent(W - m, m, 48, -1, 0);
    accent(W - m, m, 48, 0, 1);
    accent(m, H - m, 48, 1, 0);
    accent(m, H - m, 48, 0, -1);
    accent(W - m, H - m, 48, -1, 0);
    accent(W - m, H - m, 48, 0, -1);
  }

  function drawGlassPanel(ctx, x, y, w, h, r) {
    ctx.save();
    storyRoundRect(ctx, x, y, w, h, r);
    const fill = ctx.createLinearGradient(x, y, x, y + h);
    fill.addColorStop(0, 'rgba(0, 240, 255, 0.14)');
    fill.addColorStop(1, 'rgba(0, 80, 120, 0.06)');
    ctx.fillStyle = fill;
    ctx.fill();
    const stroke = ctx.createLinearGradient(x, y, x + w, y + h);
    stroke.addColorStop(0, 'rgba(0, 240, 255, 0.85)');
    stroke.addColorStop(0.5, 'rgba(120, 220, 255, 0.35)');
    stroke.addColorStop(1, 'rgba(255, 80, 140, 0.55)');
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(0, 240, 255, 0.35)';
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  /** コース名と重複しないサブタイトル（区間・方向のみ） */
  function storyCourseSubtitle(courseName, routeLabel, dirLabel) {
    const route = (routeLabel || '').trim();
    if (!route || route === '—' || route === courseName) {
      return dirLabel && !routeLabelShowsDir(route, dirLabel) ? dirLabel : '';
    }
    const esc = courseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let sub = route
      .replace(new RegExp(`^${esc}(?:\\s*[·・]\\s*|\\s+|$)`), '')
      .trim();
    if (!sub) {
      return dirLabel && !routeLabelShowsDir(route, dirLabel) ? dirLabel : '';
    }
    if (dirLabel && !routeLabelShowsDir(route, dirLabel) && !sub.includes(dirLabel)) {
      sub = `${sub} · ${dirLabel}`;
    }
    return sub;
  }

  function layoutStoryCourseCard(ctx, W, courseName, routeLabel, dirLabel, startY) {
    const cardX = 56;
    const cardW = W - cardX * 2;
    const pad = 36;
    const innerW = cardW - pad * 2;
    const cx = cardX + cardW / 2;
    const panelY = startY || 248;

    const displayTitle = storyCourseDisplayTitle(courseName, routeLabel);
    const subtitle = storyCourseDisplaySubtitle(courseName, routeLabel, dirLabel);

    const labelFont = `500 17px ${FONT_JP}`;
    const labelH = lineHeightForFont(ctx, labelFont, 8);
    const titleFit = fitStoryCourseTitle(ctx, displayTitle, innerW, 42, 30);
    const titleLines = titleFit.lines;
    const titleFont = titleFit.font;
    const titleLineH = titleFit.lineH;

    let subLines = [];
    let subFont = '';
    let subLineH = 0;
    const subGap = 12;
    if (subtitle) {
      subFont = `400 22px ${FONT_JP}`;
      ctx.font = subFont;
      subLines = wrapLines(ctx, subtitle, innerW).slice(0, 2);
      subLineH = lineHeightForFont(ctx, subFont, 8);
    }

    const contentH =
      labelH +
      10 +
      titleLines.length * titleLineH +
      (subLines.length ? subGap + subLines.length * subLineH : 0);
    const panelH = contentH + pad * 2 + 28;

    return {
      cardX,
      cardW,
      panelY,
      panelH,
      cx,
      pad,
      labelFont,
      labelH,
      titleFont,
      titleLines,
      titleLineH,
      subFont,
      subLines,
      subLineH,
      subGap
    };
  }

  function drawStoryCoursePanel(ctx, layout) {
    const { cardX, panelY, cardW, panelH } = layout;
    ctx.save();
    storyRoundRect(ctx, cardX, panelY, cardW, panelH, 12);
    ctx.fillStyle = 'rgba(6, 12, 20, 0.94)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    const accentY = panelY + 14;
    ctx.fillStyle = 'rgba(0, 240, 255, 0.55)';
    ctx.fillRect(cardX + 32, accentY, cardW - 64, 2);
    ctx.restore();
  }

  function drawStoryCourseText(ctx, layout) {
    const { panelY, cx, pad, labelFont, labelH, titleFont, titleLines, titleLineH, subFont, subLines, subLineH, subGap } =
      layout;
    ctx.save();
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';

    let y = panelY + pad;
    ctx.font = labelFont;
    ctx.fillStyle = 'rgba(0, 229, 255, 0.65)';
    ctx.fillText('コース', cx, y);
    y += labelH + 10;

    ctx.font = titleFont;
    ctx.fillStyle = '#f1f5f9';
    titleLines.forEach((ln) => {
      ctx.fillText(ln, cx, y);
      y += titleLineH;
    });

    if (subLines.length) {
      y += subGap;
      ctx.font = subFont;
      ctx.fillStyle = '#94a3b8';
      subLines.forEach((ln) => {
        ctx.fillText(ln, cx, y);
        y += subLineH;
      });
    }

    ctx.restore();
  }

  function drawStoryHeader(ctx, W) {
    const y0 = 118;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#64748b';
    ctx.font = `600 22px ${FONT_LATIN}`;
    ctx.fillText('OSAKA KOUDO SIMULATOR', W / 2, y0);
    ctx.fillStyle = '#fca5a5';
    ctx.font = `700 26px ${FONT_LATIN}`;
    ctx.fillText('GPS TIME ATTACK', W / 2, y0 + 44);
    ctx.fillStyle = 'rgba(0, 240, 255, 0.4)';
    ctx.fillRect(W / 2 - 96, y0 + 62, 192, 2);
    return y0 + 72;
  }

  function drawTimeHud(ctx, W, topY, time) {
    const hudW = 880;
    const hudH = 148;
    const hudX = (W - hudW) / 2;
    drawGlassPanel(ctx, hudX, topY, hudW, hudH, 14);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#64748b';
    ctx.font = `600 24px ${FONT_LATIN}`;
    ctx.fillText('LAP TIME', W / 2, topY + 34);
    ctx.fillStyle = '#00f0ff';
    ctx.font = `900 88px ${FONT_TIME}`;
    ctx.shadowColor = 'rgba(0, 240, 255, 0.55)';
    ctx.shadowBlur = 24;
    ctx.fillText(time, W / 2, topY + 116);
    ctx.shadowBlur = 0;
    return topY + hudH;
  }

  function dataUrlToPngBlob(dataUrl) {
    try {
      const bin = atob(dataUrl.split(',')[1] || '');
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: 'image/png' });
    } catch (_) {
      return null;
    }
  }

  function canvasToPngBlob(canvas) {
    return new Promise((resolve) => {
      try {
        if (typeof canvas.toBlob === 'function') {
          canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else resolve(dataUrlToPngBlob(canvas.toDataURL('image/png')));
          }, 'image/png', 0.92);
          return;
        }
        resolve(dataUrlToPngBlob(canvas.toDataURL('image/png')));
      } catch (_) {
        resolve(null);
      }
    });
  }

  async function buildStoryImageBlob(meta, opts) {
    try {
    const courseName = (meta.courseName || '—').trim() || '—';
    const routeLabel = (meta.routeLabel || meta.gateName || '—').trim() || '—';
    const dirLabel = meta.dirLabel || '';
    const time = meta.time || '—';
    const W = 1080;
    const H = 1920;
    if (!opts?.skipFontWait) {
      await ensureStoryCanvasFonts();
    }
    const canvas = global.document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const gap = 28;
    const cardX = 56;
    const cardW = W - cardX * 2;

    drawStoryBackground(ctx, W, H);
    const headerBottom = drawStoryHeader(ctx, W);
    const courseTop = headerBottom + 28;
    const courseLayout = layoutStoryCourseCard(ctx, W, courseName, routeLabel, dirLabel, courseTop);
    drawStoryCoursePanel(ctx, courseLayout);
    const panelBottom = courseLayout.panelY + courseLayout.panelH;

    const mapX = cardX;
    const mapW = cardW;
    const mapLabelY = panelBottom + gap;
    const mapTop = mapLabelY + 22;
    const timeBlockH = 148;
    const footerH = 110;
    const mapH = Math.max(
      340,
      Math.min(440, H - mapTop - timeBlockH - footerH - gap * 3)
    );

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(0, 240, 255, 0.55)';
    ctx.font = `600 17px ${FONT_LATIN}`;
    ctx.fillText('ROUTE MAP', mapX + 6, mapLabelY);

    let drewMap = false;
    try {
      drewMap = !!global.renderStoryCourseMap?.(ctx, mapX, mapTop, mapW, mapH, {
        courseGroup: meta.courseGroup,
        courseDir: meta.courseDir,
        testMode: meta.testMode,
        showHudLabel: false
      });
    } catch (mapErr) {
      console.warn('renderStoryCourseMap failed', mapErr);
    }
    if (!drewMap) {
      drawGlassPanel(ctx, mapX, mapTop, mapW, mapH, 14);
      ctx.fillStyle = '#64748b';
      ctx.font = `500 24px ${FONT_JP}`;
      ctx.textAlign = 'center';
      ctx.fillText(routeLabel, mapX + mapW / 2, mapTop + mapH / 2);
      ctx.textAlign = 'left';
    }

    drawStoryCourseText(ctx, courseLayout);

    const timeTop = mapTop + mapH + gap;
    const timeBottom = drawTimeHud(ctx, W, timeTop, time);

    ctx.textAlign = 'center';
    const footerY = Math.min(timeBottom + gap, H - footerH);
    ctx.fillStyle = 'rgba(71, 85, 105, 0.95)';
    ctx.font = `500 21px ${FONT_JP}`;
    ctx.fillText('#大阪公道シミュレーター  #タイムアタック', W / 2, footerY + 28);
    ctx.fillStyle = '#00e5ff';
    ctx.font = `600 22px ${FONT_LATIN}`;
    const host = SHARE_APP_URL.replace(/^https?:\/\//, '');
    ctx.fillText(host, W / 2, footerY + 62);

    return await canvasToPngBlob(canvas);
    } catch (err) {
      console.error('buildStoryImageBlob failed', err);
      return null;
    }
  }

  function storyImageFilename(timeLabel) {
    const safe = String(timeLabel || 'lap').replace(/[^\dA-Za-z-]+/g, '-');
    return `osaka-koudou-lap-${safe}.png`;
  }

  const storyPreviewState = { blob: null, timeLabel: '', objectUrl: null, dataUrl: null };

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new global.FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('read failed'));
      reader.readAsDataURL(blob);
    });
  }

  function closeStoryImagePreview() {
    const modal = global.document.getElementById('storyImageModal');
    const img = global.document.getElementById('storyImagePreview');
    const loading = global.document.getElementById('storyImageLoading');
    if (storyPreviewState.objectUrl) {
      URL.revokeObjectURL(storyPreviewState.objectUrl);
      storyPreviewState.objectUrl = null;
    }
    storyPreviewState.dataUrl = null;
    storyPreviewState.blob = null;
    storyPreviewState.timeLabel = '';
    if (img) {
      img.removeAttribute('src');
      img.style.display = 'none';
    }
    if (loading) {
      loading.style.display = 'block';
      loading.textContent = '画像を作成中…';
    }
    if (modal) modal.hidden = true;
    global.document.body.style.overflow = '';
  }

  function showStoryImagePreviewLoading() {
    const modal = global.document.getElementById('storyImageModal');
    const img = global.document.getElementById('storyImagePreview');
    const loading = global.document.getElementById('storyImageLoading');
    if (!modal) return;
    if (img) img.style.display = 'none';
    if (loading) {
      loading.style.display = 'block';
      loading.textContent = '画像を作成中…';
    }
    modal.hidden = false;
    global.document.body.style.overflow = 'hidden';
  }

  async function openStoryImagePreview(blob, timeLabel) {
    const modal = global.document.getElementById('storyImageModal');
    const img = global.document.getElementById('storyImagePreview');
    const loading = global.document.getElementById('storyImageLoading');
    if (!modal || !img || !blob) return;
    if (storyPreviewState.objectUrl) URL.revokeObjectURL(storyPreviewState.objectUrl);
    storyPreviewState.objectUrl = null;
    storyPreviewState.dataUrl = null;
    storyPreviewState.blob = blob;
    storyPreviewState.timeLabel = timeLabel || 'lap';

    const showImg = () => {
      if (loading) loading.style.display = 'none';
      img.style.display = 'block';
      modal.hidden = false;
      global.document.body.style.overflow = 'hidden';
    };

    img.onerror = () => {
      global.alert('画像の表示に失敗しました。もう一度お試しください。');
      closeStoryImagePreview();
    };

    try {
      if (isMobileOrStandalone()) {
        storyPreviewState.dataUrl = await blobToDataUrl(blob);
        img.src = storyPreviewState.dataUrl;
      } else {
        storyPreviewState.objectUrl = URL.createObjectURL(blob);
        img.src = storyPreviewState.objectUrl;
      }
      if (img.complete) showImg();
      else img.onload = () => {
        img.onload = null;
        showImg();
      };
    } catch (_) {
      storyPreviewState.objectUrl = URL.createObjectURL(blob);
      img.src = storyPreviewState.objectUrl;
      img.onload = () => {
        img.onload = null;
        showImg();
      };
    }
  }

  /** iOS/Android は a[download] がファイル画面に遷移するため共有シートを優先 */
  async function saveBlobToPhotos(blob, filename) {
    if (isMobileOrStandalone()) {
      const shared = await shareBlobViaWebShare(blob, filename);
      if (shared) return true;
    }
    downloadBlobDesktop(blob, filename);
    return true;
  }

  function initStoryImagePreviewModal(addGpsLogFn) {
    const modal = global.document.getElementById('storyImageModal');
    if (!modal || modal.dataset.wired === '1') return;
    modal.dataset.wired = '1';

    const onClose = () => closeStoryImagePreview();
    modal.querySelectorAll('[data-story-modal-close]').forEach((el) => {
      el.addEventListener('click', onClose);
    });

    const saveBtn = global.document.getElementById('storyImageSaveBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const { blob, timeLabel } = storyPreviewState;
        if (!blob) return;
        saveBtn.disabled = true;
        try {
          await saveBlobToPhotos(blob, storyImageFilename(timeLabel));
          copyImageToClipboard(blob).catch(() => {});
          saveBtn.textContent = '保存しました';
          global.setTimeout(() => {
            saveBtn.textContent = '保存';
            saveBtn.disabled = false;
          }, 2000);
        } catch (err) {
          console.error('story preview save failed', err);
          global.alert('画像の保存に失敗しました。');
          saveBtn.disabled = false;
        }
      });
    }

    global.document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && modal && !modal.hidden) onClose();
    });
  }

  function downloadBlobDesktop(blob, filename) {
    const url = URL.createObjectURL(blob);
    try {
      const a = global.document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      global.document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      global.setTimeout(() => URL.revokeObjectURL(url), 3000);
    }
  }

  function downloadBlob(blob, filename) {
    if (isMobileOrStandalone()) return;
    downloadBlobDesktop(blob, filename);
  }

  async function shareBlobViaWebShare(blob, filename) {
    if (!global.navigator?.share || !global.File) return false;
    try {
      const file = new File([blob], filename, { type: 'image/png' });
      if (global.navigator.canShare && !global.navigator.canShare({ files: [file] })) {
        return false;
      }
      await global.navigator.share({ files: [file], title: '大阪公道シミュレーター' });
      return true;
    } catch (err) {
      if (err?.name === 'AbortError') return true;
      return false;
    }
  }

  const STORY_SAVE_HINT =
    'ストーリー用画像を保存しました。\n\n' +
    'Instagram → ストーリー → ギャラリー（カメラロール）から画像を選んで追加してください。';

  /** 画像保存（Instagram 遷移のあとで実行 — 同時だと iOS が遷移をキャンセルする） */
  function saveStoryImageDeferred(blob, timeLabel, delayMs, onDone) {
    const filename = storyImageFilename(timeLabel);
    const run = () => {
      try {
        if (!isMobileOrStandalone()) {
          downloadBlobDesktop(blob, filename);
        }
        copyImageToClipboard(blob).catch(() => {});
        onDone?.(true);
      } catch (err) {
        console.warn('IG image download failed', err);
        onDone?.(false);
      }
    };
    if (delayMs > 0) global.setTimeout(run, delayMs);
    else run();
  }

  /**
   * useNativeLink=true のときは <a href> に任せ、ここでは保存のみ
   */
  function saveAndLaunchInstagramSync(blob, timeLabel, useNativeLink) {
    if (isMobileOrStandalone() && !useNativeLink) {
      launchInstagramAppNow();
      saveStoryImageDeferred(blob, timeLabel, 450);
      return;
    }
    if (isMobileOrStandalone() && useNativeLink) {
      saveStoryImageDeferred(blob, timeLabel, 0);
      return;
    }
    try {
      downloadBlob(blob, storyImageFilename(timeLabel));
    } catch (err) {
      console.warn('IG image download failed', err);
    }
  }

  /**
   * IGタップ — 画像を端末に保存してから Instagram アプリを起動
   */
  async function saveImageAndOpenInstagram(blob, timeLabel) {
    if (!blob) {
      global.alert('ストーリー用画像の作成に失敗しました。');
      return;
    }

    if (isMobileOrStandalone()) {
      saveAndLaunchInstagramSync(blob, timeLabel);
      return;
    }

    downloadBlob(blob, storyImageFilename(timeLabel));
    global.alert(
      '画像をダウンロードしました。\nスマホのInstagramアプリでストーリーに画像を追加してください。'
    );
  }

  async function shareToInstagramStory(courseName, time, gateName, extra) {
    const meta = {
      courseName,
      routeLabel: extra?.routeLabel || gateName,
      dirLabel: extra?.dirLabel || '',
      time,
      gateName
    };
    const blob = await buildStoryImageBlob(meta);
    await saveImageAndOpenInstagram(blob, time);
  }

  global.shareToInstagramStory = shareToInstagramStory;
  global.saveImageAndOpenInstagram = saveImageAndOpenInstagram;
  global.deliverInstagramStory = saveImageAndOpenInstagram;

  function newRecordId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function formatRecordDate(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const SHARE_ICON_X =
    '<svg class="attack-share-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
    '<path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>' +
    '</svg>';

  const SHARE_ICON_INSTAGRAM =
    '<svg class="attack-share-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
    '<path fill="currentColor" d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 110 2.881 1.44 1.44 0 010-2.881z"/>' +
    '</svg>';

  function normalizeEntries(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map((e) => ({
      id: e.id || newRecordId(),
      at: e.at || Date.now(),
      label: e.label || '—',
      time: e.time || '—',
      ms: typeof e.ms === 'number' ? e.ms : 0,
      courseGroup: e.courseGroup || '',
      courseDir: e.courseDir || '',
      testMode: !!e.testMode
    }));
  }

  function checkIntersection(p1, p2, p3, p4) {
    const tc1 = (p1.lng - p2.lng) * (p3.lat - p1.lat) + (p1.lat - p2.lat) * (p1.lng - p3.lng);
    const tc2 = (p1.lng - p2.lng) * (p4.lat - p1.lat) + (p1.lat - p2.lat) * (p1.lng - p4.lng);
    const tc3 = (p3.lng - p4.lng) * (p1.lat - p3.lat) + (p3.lat - p4.lat) * (p3.lng - p1.lng);
    const tc4 = (p3.lng - p4.lng) * (p2.lat - p3.lat) + (p3.lat - p4.lat) * (p3.lng - p2.lng);
    return tc1 * tc2 < 0 && tc3 * tc4 < 0;
  }

  function formatTime(ms) {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const milliseconds = Math.floor(ms % 1000);
    return (
      String(minutes).padStart(2, '0') + ':' +
      String(seconds).padStart(2, '0') + '.' +
      String(milliseconds).padStart(3, '0')
    );
  }

  function loadLog() {
    try {
      let raw = localStorage.getItem(LOG_KEY);
      if (!raw) {
        raw = localStorage.getItem('osaka_kodo_attack_log_v1');
        if (raw) {
          const migrated = normalizeEntries(JSON.parse(raw));
          saveLog(migrated);
          localStorage.removeItem('osaka_kodo_attack_log_v1');
          return migrated;
        }
        return [];
      }
      return normalizeEntries(JSON.parse(raw));
    } catch (_) {
      return [];
    }
  }

  function saveLog(entries) {
    try {
      const sorted = entries
        .slice()
        .sort((a, b) => (b.at || 0) - (a.at || 0))
        .slice(0, MAX_LOG);
      localStorage.setItem(LOG_KEY, JSON.stringify(sorted));
    } catch (_) {}
  }

  /** 2点間の概算距離（m） */
  function distM(a, b) {
    const R = 6371000;
    const toR = Math.PI / 180;
    const dLat = (b.lat - a.lat) * toR;
    const dLng = (b.lng - a.lng) * toR;
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  function gateMidpoint(gate) {
    return {
      lat: (gate.pA.lat + gate.pB.lat) / 2,
      lng: (gate.pA.lng + gate.pB.lng) / 2
    };
  }

  function isLapGateGroup(groupId) {
    return !!(global.ATTACK_GATES?.[groupId]?.lap);
  }

  function resolveGateConfig(groupId, dir) {
    const gates = global.ATTACK_GATES;
    if (!gates) return null;
    if (groupId === 'test') {
      return gates.test?.lap || gates.test?.up || null;
    }
    if (!gates[groupId]) return null;
    if (dir === 'lap' && gates[groupId].lap) return gates[groupId].lap;
    const branch = gates[groupId][dir] || gates[groupId].down || gates[groupId].up;
    return branch || null;
  }

  function isBidirectionalGroup(groupId) {
    if (global.isAttackBidirectional) return global.isAttackBidirectional(groupId);
    const gates = global.ATTACK_GATES;
    const g = gates?.[groupId];
    return !!(g?.up && g?.down);
  }

  function branchLabel(groupId, dir) {
    const branch = resolveGateConfig(groupId, dir);
    return branch?.name || '—';
  }

  /** スタート／ゴールが同一ライン（テスト・環状など） */
  function gatesShareSameLine(cfg) {
    if (!cfg?.start?.pA || !cfg?.goal?.pA) return false;
    const s = cfg.start;
    const g = cfg.goal;
    return (
      s.pA.lat === g.pA.lat &&
      s.pA.lng === g.pA.lng &&
      s.pB.lat === g.pB.lat &&
      s.pB.lng === g.pB.lng
    );
  }

  function lapNeedsDepartArming(cfg, inTestMode) {
    return !!(cfg?.lapMode && (inTestMode || gatesShareSameLine(cfg)));
  }

  function initTimeAttack(opts) {
    const getCourseGroup = opts.getCourseGroup;
    const getCourseDir = opts.getCourseDir;
    const onUiChange = opts.onUiChange;
    const onCourseDirDetected = opts.onCourseDirDetected;
    const els = opts.elements;

    let active = false;
    let watchId = null;
    let isRacing = false;
    let startTime = 0;
    let lastPosition = null;
    let uiInterval = null;
    let currentConfig = null;
    /** 計測待機中の双方向ゲート（上り／下り自動判定用） */
    let pendingBidirectional = null;
    let testMode = false;
    let goalArmed = false;
    let startGateMid = null;
    let lastCoordsPaint = 0;
    /** スタート直後の誤ゴール防止（同一ライン・GPSノイズ対策） */
    const MIN_RACE_MS = 2500;
    const MIN_DIST_FROM_START_M = 30;

    function addGpsLog(text) {
      if (!els.gpsLog) return;
      els.gpsLog.innerHTML += `> ${text}<br>`;
      els.gpsLog.scrollTop = els.gpsLog.scrollHeight;
    }

    const MSG = {
      off: '計測地点を通過するとスタート／ゴールを判定します',
      idle: '計測地点の通過を待機中',
      racing: '計測中 — ゴール地点を通過で停止',
      stopped: 'ストップ — 計測地点通過で再スタート',
      finished: 'ゴール地点通過 · 記録を保存しました',
      errorPos: '位置情報を取得できません（設定を確認）',
      errorGate: '計測地点を取得できません（ネットを確認）',
      errorUnsupported: 'この端末は位置情報に非対応です',
      errorUnset: 'このコースの計測地点が未設定です'
    };

    const GPS_LABEL = { on: 'GPS計測中', off: 'GPS停止中' };
    const GPS_TOGGLE = { on: 'GPS計測を停止', off: 'GPS計測を開始' };

    function setGpsPower(on) {
      if (els.timerPulse) {
        els.timerPulse.classList.toggle('measuring-pulse', on);
      }
      if (els.gpsPower) {
        const textEl = els.gpsPower.querySelector('.gps-power__text');
        if (textEl) textEl.textContent = on ? GPS_LABEL.on : GPS_LABEL.off;
        els.gpsPower.className = 'gps-power ' + (on ? 'gps-power-on' : 'gps-power-off');
      }
      if (els.gpsHud) {
        els.gpsHud.className = 'attack-gps-hud ' + (on ? 'attack-gps-hud--on' : 'attack-gps-hud--off');
      }
      if (els.gpsHudLabel) {
        els.gpsHudLabel.textContent = on ? GPS_LABEL.on : GPS_LABEL.off;
      }
      if (els.toggleBtn) {
        els.toggleBtn.textContent = on ? GPS_TOGGLE.on : GPS_TOGGLE.off;
        els.toggleBtn.setAttribute('aria-label', on ? 'GPS計測を停止する' : 'GPS計測を開始する');
        els.toggleBtn.className =
          'attack-gps-toggle ' + (on ? 'attack-gps-toggle--on' : 'attack-gps-toggle--off');
      }
    }

    function setStatus(text, mode) {
      if (!els.status) return;
      els.status.textContent = text;
      els.status.className = 'text-xs font-bold tracking-wide ';
      if (mode === 'racing') els.status.className += 'text-motec-ok glow-cyan';
      else if (mode === 'finished') els.status.className += 'text-sky-400';
      else if (mode === 'error') els.status.className += 'text-motec-warn';
      else if (mode === 'warn') els.status.className += 'text-amber-400';
      else if (mode === 'off') els.status.className += 'text-slate-500';
      else els.status.className += 'text-amber-400/90';
    }

    function setTimerClass(mode) {
      if (!els.time) return;
      const base = 'attack-timer speed-text font-black tabular-nums tracking-widest ';
      if (mode === 'racing') els.time.className = base + 'text-motec-ok glow-cyan';
      else if (mode === 'finished') els.time.className = base + 'text-sky-400 glow-cyan';
      else els.time.className = base + 'text-red-400 glow-red';
    }

    function updateLogCount(n) {
      if (els.logCount) els.logCount.textContent = `(${n})`;
    }

    function shareRecordToX(id) {
      const entry = loadLog().find((e) => e.id === id);
      if (!entry) return;
      const meta = entryShareMeta(entry);
      shareToX(meta.courseName, meta.time, meta.gateName);
    }

    function notifyStoryImageSaved(showAlert) {
      addGpsLog('画像保存: フォトに保存済み → IGストーリーでギャラリーから追加');
      if (showAlert) global.alert(STORY_SAVE_HINT);
    }

    function previewRecordStoryImage(id) {
      const entry = loadLog().find((e) => e.id === id);
      if (!entry) return;
      const meta = entryShareMeta(entry);
      const cached = storyBlobCache.get(storyCacheKey(id));

      const finish = (blob) => {
        if (!blob) {
          closeStoryImagePreview();
          global.alert('ストーリー用画像の作成に失敗しました。');
          return;
        }
        storyBlobCache.set(storyCacheKey(id), blob);
        openStoryImagePreview(blob, meta.time).then(() => {
          addGpsLog('画像プレビューを表示 — 保存ボタンでフォトへ');
        });
      };

      showStoryImagePreviewLoading();

      if (cached) {
        finish(cached);
        return;
      }

      addGpsLog('画像を準備中…');
      buildStoryImageBlob(meta, { skipFontWait: true })
        .then(finish)
        .catch((err) => {
          console.error('previewRecordStoryImage build failed', err);
          closeStoryImagePreview();
          global.alert('画像の表示に失敗しました。');
        });
    }

    function deliverInstagramShare(blob, meta, entryId, useNativeLink) {
      if (!blob) {
        global.alert('ストーリー用画像の作成に失敗しました。');
        return;
      }
      if (entryId) storyBlobCache.set(storyCacheKey(entryId), blob);

      if (isMobileOrStandalone()) {
        const afterSave = () => notifyStoryImageSaved(false);
        if (useNativeLink) {
          saveStoryImageDeferred(blob, meta.time, 0, afterSave);
        } else {
          launchInstagramAppNow();
          saveStoryImageDeferred(blob, meta.time, 450, afterSave);
        }
        addGpsLog('IG: Instagramを起動（画像は自動保存）');
        return;
      }

      const filename = storyImageFilename(meta.time);
      shareBlobViaWebShare(blob, filename)
        .then((ok) => {
          if (ok) {
            addGpsLog('IG: 共有シートを表示');
            return;
          }
          downloadBlob(blob, filename);
          global.alert(
            '画像をダウンロードしました。\nスマホのInstagramアプリでストーリーに画像を追加してください。'
          );
        })
        .catch(() => {
          downloadBlob(blob, filename);
          global.alert(
            '画像をダウンロードしました。\nスマホのInstagramアプリでストーリーに画像を追加してください。'
          );
        });
    }

    function shareRecordToInstagram(id, useNativeLink) {
      const entry = loadLog().find((e) => e.id === id);
      if (!entry) return;
      const meta = entryShareMeta(entry);
      const cached = storyBlobCache.get(storyCacheKey(id));

      if (cached) {
        deliverInstagramShare(cached, meta, id, useNativeLink);
        return;
      }

      addGpsLog('IG: 画像を準備中…');
      if (isMobileOrStandalone() && !useNativeLink) {
        launchInstagramAppNow();
      }

      buildStoryImageBlob(meta, { skipFontWait: true })
        .then((blob) => {
          if (!blob) {
            global.alert('ストーリー用画像の作成に失敗しました。');
            return;
          }
          deliverInstagramShare(blob, meta, id, false);
        })
        .catch((err) => {
          console.error('IG build failed', err);
          global.alert('共有できませんでした。');
        });
    }

    function renderLogList() {
      if (!els.logList) return;
      const entries = loadLog();
      updateLogCount(entries.length);
      if (!entries.length) {
        els.logList.innerHTML = '<p class="text-slate-600 text-[10px] py-1">記録なし — ゴール地点通過で自動保存</p>';
        return;
      }
      els.logList.innerHTML = entries.map((e) => {
        const date = formatRecordDate(e.at);
        const label = escapeHtml(e.label);
        const time = escapeHtml(e.time);
        const id = escapeHtml(e.id);
        const igHref = escapeHtml(getInstagramLaunchHref());
        return (
          `<article class="attack-record-row py-1.5 border-b border-motec-border/60" data-record-id="${id}">` +
          `<div class="min-w-0">` +
          `<div class="text-motec-ok font-bold tabular-nums text-sm">${time}</div>` +
          `<div class="text-[10px] text-slate-500 truncate">${label}</div>` +
          `<div class="text-[9px] text-slate-600">${date}</div></div>` +
          `<div class="attack-record-actions" role="group" aria-label="記録の共有">` +
          `<button type="button" class="attack-record-share attack-record-share--save attack-record-action-btn" data-save-img-id="${id}" ` +
          `aria-label="ストーリー用画像をプレビュー" title="画像を表示してから保存">画像</button>` +
          `<a href="${igHref}" class="attack-record-share attack-record-share--ig attack-record-share--brand attack-record-action-btn" data-share-ig-id="${id}" ` +
          `aria-label="Instagramを開く（画像は自動保存）" title="画像を自動保存してInstagramを起動">${SHARE_ICON_INSTAGRAM}</a>` +
          `<button type="button" class="attack-record-share attack-record-share--x attack-record-share--brand attack-record-action-btn" data-share-id="${id}" ` +
          `aria-label="Xで共有" title="Xで共有">${SHARE_ICON_X}</button>` +
          `<button type="button" class="attack-record-del attack-record-action-btn" data-delete-id="${id}" aria-label="この記録を削除">削除</button>` +
          `</div></article>`
        );
      }).join('');
      entries.slice(0, 20).forEach((e) => {
        cacheStoryBlobForEntry(e);
      });
    }

    function deleteRecord(id) {
      if (!id) return;
      const entry = loadLog().find((e) => e.id === id);
      const label = entry ? `${entry.time} · ${entry.label || '—'}` : 'この記録';
      if (
        !confirmTwice(
          `${label} を削除しますか？`,
          '削除した記録は元に戻せません。削除しますか？'
        )
      ) {
        return;
      }
      saveLog(loadLog().filter((e) => e.id !== id));
      renderLogList();
      addGpsLog('記録を削除しました');
    }

    function clearAllRecords() {
      if (!loadLog().length) return;
      if (
        !confirmTwice(
          'すべてのタイム記録を削除しますか？',
          '全記録を削除します。よろしいですか？'
        )
      ) {
        return;
      }
      saveLog([]);
      renderLogList();
      addGpsLog('全記録を削除しました');
    }

    function pushResult(finalMs) {
      const group = testMode ? 'test' : (currentConfig?.groupId || getCourseGroup());
      const dir = testMode ? 'lap' : (currentConfig?.courseDir || getCourseDir());
      const entry = {
        id: newRecordId(),
        at: Date.now(),
        label: currentConfig?.name || '—',
        time: formatTime(finalMs),
        ms: Math.round(finalMs),
        courseGroup: group,
        courseDir: dir,
        testMode: !!testMode
      };
      const entries = loadLog();
      entries.unshift(entry);
      saveLog(entries);
      renderLogList();
      addGpsLog(`記録保存 · ${entry.time}`);
      RecordChime.playFinish();
      cacheStoryBlobForEntry(entry);
    }

    let syncToken = 0;
    let gateLoadPromise = null;

    function gateSourceLabel(src) {
      if (src === 'openstreetmap') return ' · 道路方位OSM';
      if (src === 'fallback') return ' · オフラインゲート';
      return '';
    }

    function updateGateNote(cfg) {
      if (!els.gateNote || !cfg) return;
      if (testMode || cfg.lapMode) {
        els.gateNote.textContent =
          `${cfg.name} · 計測基点を通過するたびにラップ記録（2周目以降も自動継続）`;
        return;
      }
      if (cfg.bidirectional) {
        const src = gateSourceLabel(cfg.gateSource);
        els.gateNote.textContent =
          `${cfg.nameBase} · どちらの計測地点からでも可${src} · 最初の通過で方向自動`;
        return;
      }
      const src = gateSourceLabel(cfg.gateSource);
      els.gateNote.textContent = `${cfg.name}${src} · スタート地点通過で計測開始`;
    }

    async function resolveGateDef(def) {
      if (!def) return null;
      if (def.pA && def.pB) {
        return { pA: def.pA, pB: def.pB, meta: { source: 'static' } };
      }
      if (def.autoRoad && def.center && global.RoadGate) {
        try {
          return await global.RoadGate.buildGateFromRoad(
            def.center.lat, def.center.lng, { halfWidthM: def.halfWidthM }
          );
        } catch (err) {
          if (def.fallback) {
            return {
              pA: def.fallback.pA,
              pB: def.fallback.pB,
              meta: { source: 'fallback', error: err.message }
            };
          }
          throw err;
        }
      }
      if (def.fallback) {
        return { pA: def.fallback.pA, pB: def.fallback.pB, meta: { source: 'fallback' } };
      }
      return null;
    }

    async function resolveBranchGates(branch) {
      const [start, goal] = await Promise.all([
        resolveGateDef(branch.start),
        resolveGateDef(branch.goal)
      ]);
      if (!start?.pA || !goal?.pA) throw new Error('ゲート解決失敗');
      const src =
        start.meta?.source === 'openstreetmap' || goal.meta?.source === 'openstreetmap'
          ? 'openstreetmap'
          : start.meta?.source || goal.meta?.source || 'static';
      return { name: branch.name, start, goal, gateSource: src };
    }

    function nameBaseFromBranch(branch) {
      if (!branch?.name) return 'コース';
      return branch.name.replace(/（上り）|（下り）/g, '').trim();
    }

    async function resolveBidirectionalGates(groupId) {
      const gates = global.ATTACK_GATES;
      const up = gates?.[groupId]?.up;
      if (!up || !gates[groupId]?.down) throw new Error('双方向ゲート未定義');
      const [gateA, gateB] = await Promise.all([
        resolveGateDef(up.start),
        resolveGateDef(up.goal)
      ]);
      if (!gateA?.pA || !gateB?.pA) throw new Error('ゲート解決失敗');
      const src =
        gateA.meta?.source === 'openstreetmap' || gateB.meta?.source === 'openstreetmap'
          ? 'openstreetmap'
          : gateA.meta?.source || gateB.meta?.source || 'static';
      return {
        bidirectional: true,
        groupId,
        nameBase: nameBaseFromBranch(up),
        gateA,
        gateB,
        gateSource: src
      };
    }

    function armRaceFromFirstCross(cfg, crossedA, crossedB, crossTime) {
      const groupId = cfg.groupId;
      let dir;
      if (crossedA && !crossedB) dir = 'up';
      else if (crossedB && !crossedA) dir = 'down';
      else dir = 'up';

      const start = dir === 'up' ? cfg.gateA : cfg.gateB;
      const goal = dir === 'up' ? cfg.gateB : cfg.gateA;
      const name = branchLabel(groupId, dir);
      const gateSource = cfg.gateSource;

      currentConfig = { name, start, goal, gateSource, courseDir: dir, groupId };
      isRacing = true;
      goalArmed = false;
      startGateMid = gateMidpoint(start);
      startTime = crossTime;
      setStatus(MSG.racing, 'racing');
      setTimerClass('racing');
      const dirJa = dir === 'up' ? '上り' : '下り';
      addGpsLog(`方向自動: ${dirJa}（最初の計測地点通過）`);
      addGpsLog('計測地点通過 → スタート');
      updateGateNote(currentConfig);
      onCourseDirDetected?.(dir, groupId);
      uiInterval = setInterval(() => {
        if (els.time) els.time.textContent = formatTime(performance.now() - startTime);
      }, 33);
      updateLapButtons();
      RecordChime.playStart();
    }

    function restoreBidirectionalIdle() {
      if (!pendingBidirectional) return;
      currentConfig = pendingBidirectional;
      updateGateNote(currentConfig);
    }

    function setTestMode(on) {
      if (isRacing) return;
      testMode = !!on;
      syncCourse();
      onUiChange?.();
      if (active) {
        if (testMode) addGpsLog('テストゲートモード ON · ゲート同期済み');
        else addGpsLog('テストゲートモード OFF');
      } else if (testMode) {
        addGpsLog('テストゲートモード ON');
      }
    }

    function syncCourse() {
      if (isRacing) return gateLoadPromise || Promise.resolve();
      const token = ++syncToken;
      const group = testMode ? 'test' : getCourseGroup();
      const dir = testMode || isLapGateGroup(group) ? 'lap' : getCourseDir();
      const branch = resolveGateConfig(group, dir);

      if (!branch) {
        currentConfig = null;
        if (!active) setStatus(MSG.errorUnset, 'warn');
        if (els.gateNote) els.gateNote.textContent = '—';
        return Promise.resolve();
      }

      const useAutoDir = !testMode && isBidirectionalGroup(group);
      const needsOsm = !testMode && (
        useAutoDir
          ? !!(global.ATTACK_GATES?.[group]?.up?.start?.autoRoad)
          : !!(branch.start?.autoRoad || branch.goal?.autoRoad)
      );
      if (needsOsm && els.gateNote) {
        const label = useAutoDir ? nameBaseFromBranch(resolveGateConfig(group, 'up')) : branch.name;
        els.gateNote.textContent = `${label} · 道路データ取得中…`;
      }

      gateLoadPromise = (async () => {
        try {
          let cfg;
          if (useAutoDir) {
            cfg = await resolveBidirectionalGates(group);
            cfg.groupId = group;
          } else {
            cfg = await resolveBranchGates(branch);
            if (isLapGateGroup(group)) {
              cfg.lapMode = true;
              cfg.courseDir = 'lap';
            }
            cfg.groupId = group;
          }
          if (token !== syncToken) return;
          pendingBidirectional = useAutoDir ? cfg : null;
          currentConfig = cfg;
          updateGateNote(cfg);
          if (active) {
            const mode = useAutoDir ? '方向自動' : cfg.gateSource;
            addGpsLog(`コース同期: ${useAutoDir ? cfg.nameBase : cfg.name} (${mode})`);
            setStatus(MSG.idle, 'idle');
          }
        } catch (err) {
          if (token !== syncToken) return;
          pendingBidirectional = null;
          addGpsLog(`計測地点取得失敗: ${err.message}`);
          if (active) setStatus(MSG.errorGate, 'error');
          if (els.gateNote) {
            const label = useAutoDir ? nameBaseFromBranch(branch) : branch.name;
            els.gateNote.textContent = `${label} · OSM取得失敗`;
          }
        }
      })();

      return gateLoadPromise;
    }

    function stopWatch() {
      if (watchId != null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
    }

    function updateLapButtons() {
      if (els.resetBtn) els.resetBtn.disabled = !active;
      if (els.stopBtn) els.stopBtn.disabled = !active || !isRacing;
    }

    function clearUiTimer() {
      if (uiInterval) {
        clearInterval(uiInterval);
        uiInterval = null;
      }
    }

    function resetRaceUi() {
      isRacing = false;
      goalArmed = false;
      startGateMid = null;
      startTime = 0;
      clearUiTimer();
      setTimerClass('idle');
      if (els.time) els.time.textContent = '00:00.000';
      updateLapButtons();
    }

    function resetLap() {
      if (!active) return;
      if (
        !confirmTwice(
          '計測表示をリセットしますか？',
          'タイムを00:00.000に戻します。よろしいですか？'
        )
      ) {
        return;
      }
      resetRaceUi();
      restoreBidirectionalIdle();
      setStatus(MSG.idle, 'idle');
      addGpsLog('リセット');
    }

    function stopLap() {
      if (!active || !isRacing) return;
      const frozenMs = Math.max(0, performance.now() - startTime);
      isRacing = false;
      goalArmed = false;
      startGateMid = null;
      clearUiTimer();
      setTimerClass('idle');
      if (els.time) els.time.textContent = formatTime(frozenMs);
      updateLapButtons();
      restoreBidirectionalIdle();
      setStatus(MSG.stopped, 'idle');
      addGpsLog(`ストップ ${formatTime(frozenMs)}（記録なし）`);
    }

    function onPosition(position) {
      const currentPos = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        time: performance.now(),
        acc: position.coords.accuracy
      };

      if (!currentConfig) return;
      if (currentConfig.bidirectional) {
        if (!currentConfig.gateA?.pA || !currentConfig.gateB?.pA) return;
      } else if (!currentConfig.start?.pA || !currentConfig.goal?.pA) {
        return;
      }

      if (els.coords) {
        const now = performance.now();
        if (!isRacing || now - lastCoordsPaint > 400) {
          lastCoordsPaint = now;
          els.coords.textContent = `${currentPos.lat.toFixed(5)}, ${currentPos.lng.toFixed(5)} ±${Math.round(currentPos.acc || 0)}m`;
        }
      }

      if (lastPosition) {
        if (currentConfig.lapMode && currentConfig.start?.pA) {
          const needsDepart = lapNeedsDepartArming(currentConfig, testMode);
          if (isRacing && needsDepart && !goalArmed && startGateMid) {
            const elapsed = performance.now() - startTime;
            const away = distM(currentPos, startGateMid);
            if (elapsed >= MIN_RACE_MS && away >= MIN_DIST_FROM_START_M) {
              goalArmed = true;
              addGpsLog(`ラップ記録準備 (${Math.round(away)}m離脱)`);
            }
          }
          const crossedLine = checkIntersection(
            lastPosition, currentPos,
            currentConfig.start.pA, currentConfig.start.pB
          );
          if (crossedLine) {
            const timeDiff = currentPos.time - lastPosition.time;
            const crossTime = lastPosition.time + timeDiff * 0.5;
            if (!isRacing) {
              isRacing = true;
              goalArmed = false;
              startGateMid = gateMidpoint(currentConfig.start);
              startTime = crossTime;
              setStatus(MSG.racing, 'racing');
              setTimerClass('racing');
              addGpsLog('計測基点通過 → ラップ計測開始');
              if (uiInterval) clearInterval(uiInterval);
              uiInterval = setInterval(() => {
                if (els.time) els.time.textContent = formatTime(performance.now() - startTime);
              }, 33);
              updateLapButtons();
              RecordChime.playStart();
            } else if (crossTime - startTime >= MIN_RACE_MS && (!needsDepart || goalArmed)) {
              const finalTime = crossTime - startTime;
              if (els.time) els.time.textContent = formatTime(finalTime);
              setStatus(MSG.finished, 'finished');
              setTimerClass('finished');
              pushResult(finalTime);
              addGpsLog(`計測基点通過 → ラップ ${formatTime(finalTime)} 記録 · 継続`);
              startTime = crossTime;
              goalArmed = false;
              setStatus(MSG.racing, 'racing');
              setTimerClass('racing');
            }
          }
        } else if (!isRacing) {
          if (currentConfig.bidirectional) {
            const crossedA = checkIntersection(
              lastPosition, currentPos,
              currentConfig.gateA.pA, currentConfig.gateA.pB
            );
            const crossedB = checkIntersection(
              lastPosition, currentPos,
              currentConfig.gateB.pA, currentConfig.gateB.pB
            );
            if (crossedA || crossedB) {
              const timeDiff = currentPos.time - lastPosition.time;
              const crossTime = lastPosition.time + timeDiff * 0.5;
              armRaceFromFirstCross(currentConfig, crossedA, crossedB, crossTime);
            }
          } else if (currentConfig.start?.pA) {
            const crossedStart = checkIntersection(
              lastPosition, currentPos,
              currentConfig.start.pA, currentConfig.start.pB
            );
            if (crossedStart) {
              isRacing = true;
              goalArmed = false;
              startGateMid = gateMidpoint(currentConfig.start);
              const timeDiff = currentPos.time - lastPosition.time;
              startTime = lastPosition.time + timeDiff * 0.5;
              setStatus(MSG.racing, 'racing');
              setTimerClass('racing');
              addGpsLog('計測地点通過 → スタート');
              uiInterval = setInterval(() => {
                if (els.time) els.time.textContent = formatTime(performance.now() - startTime);
              }, 33);
              updateLapButtons();
              RecordChime.playStart();
            }
          }
        } else if (!currentConfig.lapMode) {
          if (!goalArmed && startGateMid) {
            const elapsed = performance.now() - startTime;
            const away = distM(currentPos, startGateMid);
            if (elapsed >= MIN_RACE_MS && away >= MIN_DIST_FROM_START_M) {
              goalArmed = true;
              addGpsLog(`ゴール地点判定準備 (${Math.round(away)}m離脱)`);
            }
          }
          const crossedGoal = goalArmed && checkIntersection(
            lastPosition, currentPos,
            currentConfig.goal.pA, currentConfig.goal.pB
          );
          if (crossedGoal) {
            const timeDiff = currentPos.time - lastPosition.time;
            const finalTime = (lastPosition.time + timeDiff * 0.5) - startTime;
            resetRaceUi();
            if (els.time) els.time.textContent = formatTime(finalTime);
            setStatus(MSG.finished, 'finished');
            setTimerClass('finished');
            pushResult(finalTime);
            addGpsLog(`計測地点通過 → ゴール · ${formatTime(finalTime)}`);
            restoreBidirectionalIdle();
            setStatus(MSG.idle, 'idle');
            updateLapButtons();
          }
        }
      }

      lastPosition = currentPos;
    }

    function onGpsError(err) {
      addGpsLog(`位置情報: ${err.message}`);
      setStatus(MSG.errorPos, 'error');
      if (err?.code === 1) stopGps();
    }

    async function startGps() {
      if (!('geolocation' in navigator)) {
        setGpsPower(false);
        setStatus(MSG.errorUnsupported, 'error');
        return;
      }
      await syncCourse();
      const gatesReady = currentConfig?.bidirectional
        ? currentConfig.gateA?.pA && currentConfig.gateB?.pA
        : currentConfig?.start?.pA && currentConfig?.goal?.pA;
      if (!gatesReady) {
        setGpsPower(false);
        setStatus(MSG.errorGate, 'warn');
        return;
      }
      active = true;
      resetRaceUi();
      lastPosition = null;
      lastCoordsPaint = 0;
      stopWatch();
      setGpsPower(true);
      setStatus(MSG.idle, 'idle');
      updateLapButtons();
      addGpsLog('GPS ON · 計測地点の通過で計測します');
      watchId = navigator.geolocation.watchPosition(onPosition, onGpsError, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 5000
      });
    }

    function stopGps() {
      active = false;
      stopWatch();
      resetRaceUi();
      setGpsPower(false);
      setStatus(MSG.off, 'off');
      updateLapButtons();
      addGpsLog('GPS OFF');
    }

    function toggleGps() {
      RecordChime.unlock();
      if (active) stopGps();
      else startGps().catch(() => {});
    }

    if (els.toggleBtn) els.toggleBtn.addEventListener('click', toggleGps);
    if (els.resetBtn) els.resetBtn.addEventListener('click', resetLap);
    if (els.stopBtn) els.stopBtn.addEventListener('click', stopLap);
    if (els.logList) {
      els.logList.addEventListener(
        'touchstart',
        (ev) => {
          const preloadBtn = ev.target.closest('[data-share-ig-id],[data-save-img-id]');
          if (!preloadBtn) return;
          const rid =
            preloadBtn.getAttribute('data-share-ig-id') ||
            preloadBtn.getAttribute('data-save-img-id');
          const entry = loadLog().find((e) => e.id === rid);
          if (entry && !storyBlobCache.has(storyCacheKey(rid))) {
            cacheStoryBlobForEntry(entry);
          }
        },
        { passive: true }
      );
      els.logList.addEventListener('click', (ev) => {
        const shareBtn = ev.target.closest('[data-share-id]');
        if (shareBtn) {
          ev.preventDefault();
          shareRecordToX(shareBtn.getAttribute('data-share-id'));
          return;
        }
        const saveImgBtn = ev.target.closest('[data-save-img-id]');
        if (saveImgBtn) {
          ev.preventDefault();
          previewRecordStoryImage(saveImgBtn.getAttribute('data-save-img-id'));
          return;
        }
        const igBtn = ev.target.closest('[data-share-ig-id]');
        if (igBtn) {
          const rid = igBtn.getAttribute('data-share-ig-id');
          const hasCache = storyBlobCache.has(storyCacheKey(rid));
          const useNativeLink = isMobileOrStandalone() && hasCache && !isInAppBrowser();
          if (!useNativeLink) ev.preventDefault();
          shareRecordToInstagram(rid, useNativeLink);
          return;
        }
        const delBtn = ev.target.closest('[data-delete-id]');
        if (!delBtn) return;
        ev.preventDefault();
        deleteRecord(delBtn.getAttribute('data-delete-id'));
      });
    }
    if (els.clearAllBtn) els.clearAllBtn.addEventListener('click', clearAllRecords);

    initStoryImagePreviewModal(addGpsLog);
    renderLogList();
    ensureStoryCanvasFonts();
    setGpsPower(false);
    setStatus(MSG.off, 'off');
    updateLapButtons();
    syncCourse();

    return {
      syncCourse,
      setTestMode,
      isTestMode: () => testMode,
      isRacing: () => isRacing,
      isActive: () => active,
      isAutoDirCourse: () => !testMode && isBidirectionalGroup(getCourseGroup()),
      stopGps,
      reloadLog: renderLogList,
      shareRecordToX,
      shareRecordToInstagram,
      previewRecordStoryImage
    };
  }

  global.TimeAttack = {
    init: initTimeAttack,
    formatTime,
    shareToX,
    shareToInstagramStory
  };
})(typeof window !== 'undefined' ? window : globalThis);
