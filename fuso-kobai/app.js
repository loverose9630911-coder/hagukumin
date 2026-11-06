/* 購買スタートブック アプリ本体（ハッシュで画面を切り替える1ページアプリ） */
(function () {
  'use strict';
  var KB = window.KB;
  var main = document.getElementById('main');
  var titleEl = document.getElementById('pageTitle');
  var backBtn = document.getElementById('backBtn');
  var toastEl = document.getElementById('toast');
  var APP = '購買スタートブック';

  /* ───── 保存（端末の中だけ。使えない環境でも動く） ───── */
  var KEY = 'kobai-startbook-v1';
  var state = { read: {}, checks: {}, best: {}, last: '' };
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && typeof saved === 'object') {
      state.read = saved.read || {}; state.checks = saved.checks || {};
      state.best = saved.best || {}; state.last = saved.last || '';
    }
  } catch (e) { /* 保存なしで動かす */ }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }

  /* ───── 小物 ───── */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function rich(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>'); }
  function plain(s) { return String(s).replace(/\*\*/g, ''); }
  function chev() { return '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>'; }
  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(function () { toastEl.classList.remove('show'); }, 1800);
  }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function chapterById(id) { for (var i = 0; i < KB.CHAPTERS.length; i++) if (KB.CHAPTERS[i].id === id) return KB.CHAPTERS[i]; return null; }
  function chapterNo(id) { for (var i = 0; i < KB.CHAPTERS.length; i++) if (KB.CHAPTERS[i].id === id) return i + 1; return 0; }
  function readCount() { var n = 0; KB.CHAPTERS.forEach(function (c) { if (state.read[c.id]) n++; }); return n; }
  function setPage(title, back) {
    titleEl.textContent = title;
    backBtn.hidden = !back;
    backBtn.onclick = back ? function () { location.hash = back; } : null;
    document.title = title === APP ? APP : title + '｜' + APP;
  }
  function setTab(tab) {
    document.querySelectorAll('.tabbar a').forEach(function (a) {
      if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }
  function levelBadge(level) {
    return level === 'verified'
      ? '<span class="badge verified">出典で確認済み</span>'
      : '<span class="badge general">一般的な考え方・社内規程で確認</span>';
  }

  /* ───── 本文ブロックの描画 ───── */
  function renderBlock(b) {
    switch (b.t) {
      case 'p': return '<p>' + rich(b.x) + '</p>';
      case 'ul': return '<ul>' + b.x.map(function (x) { return '<li>' + rich(x) + '</li>'; }).join('') + '</ul>';
      case 'ol': return '<ol>' + b.x.map(function (x) { return '<li>' + rich(x) + '</li>'; }).join('') + '</ol>';
      case 'table':
        return '<div class="tbl-wrap"><table><thead><tr>' + b.head.map(function (h) { return '<th scope="col">' + esc(h) + '</th>'; }).join('') +
          '</tr></thead><tbody>' + b.rows.map(function (r) {
            return '<tr>' + r.map(function (c) { return '<td>' + rich(c) + '</td>'; }).join('') + '</tr>';
          }).join('') + '</tbody></table></div>';
      case 'note':
        var lab = { fact: '確認ポイント', warn: '注意', tip: 'メモ' }[b.kind] || '';
        return '<div class="note ' + b.kind + '"><div class="nt">' + esc(lab) + '：' + esc(b.title) + '</div>' + rich(b.x) + '</div>';
      case 'ngok':
        return '<div class="ngok"><div class="ng"><b>NG</b>' + rich(b.ng) + '</div><div class="ok"><b>OK</b>' + rich(b.ok) + '</div></div>';
      case 'tl':
        return '<ol class="tl">' + b.items.map(function (it) {
          return '<li><span class="y">' + esc(it.y) + '</span><span class="d" aria-hidden="true"></span><span class="x">' + rich(it.x) + '</span></li>';
        }).join('') + '</ol>';
      case 'steps':
        return '<ol class="steps">' + b.x.map(function (s) { return '<li><b>' + esc(s.h) + '</b><span>' + rich(s.d) + '</span></li>'; }).join('') + '</ol>';
    }
    return '';
  }

  /* ───── 画面：ホーム ───── */
  function viewHome() {
    setPage(APP, null); setTab('home');
    var total = KB.CHAPTERS.length, done = readCount();
    var nextCh = null;
    for (var i = 0; i < KB.CHAPTERS.length; i++) if (!state.read[KB.CHAPTERS[i].id]) { nextCh = KB.CHAPTERS[i]; break; }
    var cont = state.last && chapterById(state.last) && !state.read[state.last] ? chapterById(state.last) : nextCh;
    var bestAll = state.best.all;
    var html = '';
    html += '<section class="sec"><div class="panel hello"><h2>購買の仕事に、<br>自信を持って入るために。</h2>' +
      '<p>取適法、三菱ふそうの歩み、購買の心得を、1章5分前後で読めるようにまとめました。</p>' +
      '<div class="meter"><div class="meter-row"><span>マニュアルの進み具合</span><b>' + done + ' / ' + total + ' 章</b></div>' +
      '<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="' + total + '" aria-valuenow="' + done + '" aria-label="読んだ章の数"><i style="width:' + Math.round(done / total * 100) + '%"></i></div></div>';
    if (cont) {
      html += '<a class="panel next" href="#/c/' + cont.id + '"><div><div class="k">' + (state.last === cont.id ? '続きから読む' : '次に読む') + '</div>' +
        '<div class="t">第' + chapterNo(cont.id) + '章 ' + esc(cont.title) + '</div></div><span class="go">' + chev() + '</span></a>';
    } else {
      html += '<div class="note tip" style="margin-top:12px"><div class="nt">全章読了</div>おつかれさまでした。クイズとケース判定で仕上げましょう。</div>';
    }
    html += '</div></section>';

    html += '<section class="sec"><h2 class="sec-h">すぐ使う</h2><div class="quick">' +
      '<a class="panel" href="#/tools/scope"><b>対象判定</b><span>この取引は取適法の対象？規模を入れて目安を確認</span></a>' +
      '<a class="panel" href="#/tools/check"><b>発注チェック</b><span>発注前から支払まで、守ることを確認</span></a>' +
      '<a class="panel" href="#/quiz"><b>クイズ</b><span>' + (bestAll != null ? '前回のベスト ' + bestAll + '点' : '4択とOK・NG判定で腕だめし') + '</span></a>' +
      '<a class="panel" href="#/c/law-ban"><b>11の禁止行為</b><span>NG例とOK例で、やってはいけないことを確認</span></a>' +
      '</div></section>';

    html += '<section class="sec"><h2 class="sec-h">入社後に確認すること</h2><div class="panel pad">' +
      '<p class="small muted" style="margin-bottom:6px">社内規程など、公開情報では確認できない項目です。配属後に上司や社内資料で確かめ、チェックしていきましょう。</p>' +
      KB.CHECK_LIST.map(function (t, i) {
        var id = 'onb-' + i;
        return '<label class="chk"><input type="checkbox" data-chk="onboard" data-i="' + i + '"' + (state.checks['onboard:' + i] ? ' checked' : '') + ' id="' + id + '"><span>' + esc(t) + '</span></label>';
      }).join('') + '</div></section>';

    html += '<section class="sec"><div class="panel pad disclaimer">' +
      '<p><b>このアプリについて</b></p>' +
      '<p>三菱ふそうトラック・バス株式会社の公式アプリではありません。公開されている公的資料・公式発表・報道をもとに、学習用にまとめた非公式の教材です（情報は2026年11月時点で確認）。</p>' +
      '<p>各章に「出典で確認済み」か「一般的な考え方・社内規程で確認」かを表示しています。実際の判断は、社内規程と法務・コンプライアンス部門の指示に従ってください。</p>' +
      '<p>記録（読んだ章・チェック・点数）はこの端末の中にだけ保存されます。</p>' +
      '<p><button class="link-btn" type="button" id="resetBtn">記録をすべて消す</button></p>' +
      '</div></section>';
    main.innerHTML = html;
    bindChecks();
    document.getElementById('resetBtn').onclick = function () {
      if (!confirm('読んだ章・チェック・クイズの点数をすべて消します。よろしいですか？')) return;
      state = { read: {}, checks: {}, best: {}, last: '' }; save(); viewHome(); toast('記録を消しました');
    };
  }

  /* ───── 画面：マニュアル一覧＋検索 ───── */
  function viewManual(q) {
    setPage('マニュアル', null); setTab('manual');
    var html = '<div class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>' +
      '<label class="sr" for="mq" style="position:absolute;left:-999px">マニュアル内を検索</label>' +
      '<input class="input" id="mq" type="search" placeholder="キーワードで検索（例：手形、60日、ファイター）" value="' + esc(q || '') + '" autocomplete="off"></div>' +
      '<div id="mres"></div>';
    main.innerHTML = html;
    var input = document.getElementById('mq');
    function draw() { document.getElementById('mres').innerHTML = input.value.trim() ? searchHtml(input.value.trim()) : listHtml(); }
    input.addEventListener('input', draw);
    draw();
  }
  function listHtml() {
    return KB.GROUPS.map(function (g) {
      var chs = KB.CHAPTERS.filter(function (c) { return c.group === g.id; });
      return '<section class="sec"><h2 class="sec-h">' + esc(g.name) + '</h2><p class="group-sub">' + esc(g.sub) + '</p>' +
        '<ul class="panel rows">' + chs.map(function (c) {
          var n = chapterNo(c.id), d = !!state.read[c.id];
          return '<li><a class="row" href="#/c/' + c.id + '"><span class="no' + (d ? ' done' : '') + '" aria-hidden="true">' + (d ? '✓' : n) + '</span>' +
            '<span class="tx"><span class="tt">' + esc(c.title) + '</span><span class="ts">約' + c.min + '分' + (d ? '・読了' : '') + (c.level === 'general' ? '・社内規程で確認' : '') + '</span></span>' + chev() + '</a></li>';
        }).join('') + '</ul></section>';
    }).join('');
  }
  function blockText(b) {
    switch (b.t) {
      case 'p': return b.x;
      case 'ul': case 'ol': return b.x.join(' ');
      case 'table': return b.head.join(' ') + ' ' + b.rows.map(function (r) { return r.join(' '); }).join(' ');
      case 'note': return b.title + ' ' + b.x;
      case 'ngok': return b.ng + ' ' + b.ok;
      case 'tl': return b.items.map(function (i) { return i.y + ' ' + i.x; }).join(' ');
      case 'steps': return b.x.map(function (s) { return s.h + ' ' + s.d; }).join(' ');
    }
    return '';
  }
  function searchHtml(q) {
    var ql = q.toLowerCase(), hits = [];
    KB.CHAPTERS.forEach(function (c) {
      c.sections.forEach(function (s, si) {
        var txt = plain(s.h + ' ' + s.blocks.map(blockText).join(' ')).replace(/\n/g, ' ');
        var at = txt.toLowerCase().indexOf(ql);
        if (at >= 0) hits.push({ c: c, si: si, h: s.h, txt: txt, at: at });
      });
    });
    KB.GLOSSARY.forEach(function (g) {
      var txt = g[0] + '：' + g[1]; var at = txt.toLowerCase().indexOf(ql);
      if (at >= 0) hits.push({ gl: true, h: g[0], txt: txt, at: at });
    });
    if (!hits.length) return '<div class="empty">「' + esc(q) + '」は見つかりませんでした。<br>別の言葉（ひらがな・漢字）でも試してください。</div>';
    return '<p class="small muted" style="margin:12px 2px 8px">' + hits.length + '件</p><ul class="panel rows">' + hits.slice(0, 50).map(function (h) {
      var from = Math.max(0, h.at - 24), snip = h.txt.slice(from, h.at + q.length + 40);
      var i = snip.toLowerCase().indexOf(ql);
      var sn = (from > 0 ? '…' : '') + esc(snip.slice(0, i)) + '<mark>' + esc(snip.slice(i, i + q.length)) + '</mark>' + esc(snip.slice(i + q.length)) + '…';
      var href = h.gl ? '#/words' : '#/c/' + h.c.id + '/' + h.si;
      var tt = h.gl ? '用語：' + h.h : '第' + chapterNo(h.c.id) + '章 ' + h.c.title + '／' + h.h;
      return '<li><a class="hit" href="' + href + '"><div class="tt">' + esc(tt) + '</div><div class="sn">' + sn + '</div></a></li>';
    }).join('') + '</ul>';
  }

  /* ───── 画面：章を読む ───── */
  function viewChapter(id, secIdx) {
    var c = chapterById(id);
    if (!c) { location.hash = '#/manual'; return; }
    var n = chapterNo(id);
    setPage('第' + n + '章 ' + c.title, '#/manual'); setTab('manual');
    state.last = id; save();
    var html = '<article><div class="ch-head"><h2>' + esc(c.title) + '</h2><p class="lead">' + rich(c.lead) + '</p>' +
      '<div class="badges">' + levelBadge(c.level) + '<span class="badge time">約' + c.min + '分</span></div></div>';
    if (c.sections.length > 2) {
      html += '<details class="panel toc"><summary>この章の目次（' + c.sections.length + '項目）</summary><ol>' +
        c.sections.map(function (s, i) { return '<li><a href="#/c/' + id + '/' + i + '">' + esc(s.h) + '</a></li>'; }).join('') + '</ol></details>';
    }
    html += '<div class="body">' + c.sections.map(function (s, i) {
      return '<h3 class="block-h" id="s' + i + '">' + esc(s.h) + '</h3>' + s.blocks.map(renderBlock).join('');
    }).join('') + '</div>';
    if (c.src.length) {
      html += '<section class="panel src"><h3>この章の出典</h3><ol>' + c.src.map(function (k) {
        var s = KB.SOURCES[k];
        return '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.name) + '</a></li>';
      }).join('') + '</ol></section>';
    } else {
      html += '<section class="panel src"><h3>この章について</h3><p>購買実務の一般的な考え方をまとめた章です。具体的な基準・手続きは会社ごとに異なるため、社内規程で確認してください。</p></section>';
    }
    var next = KB.CHAPTERS[n] || null;
    var done = !!state.read[id];
    html += '<div class="ch-foot"><button class="btn ' + (done ? 'done' : 'primary') + '" id="readBtn" type="button">' + (done ? '読了済み（取り消す）' : '読んだ！') + '</button>' +
      (next ? '<a class="btn" href="#/c/' + next.id + '">次の章：' + esc(next.title) + '</a>' : '<a class="btn" href="#/quiz">クイズで確認する</a>') + '</div></article>';
    main.innerHTML = html;
    document.getElementById('readBtn').onclick = function () {
      if (state.read[id]) { delete state.read[id]; save(); viewChapter(id); toast('読了を取り消しました'); return; }
      state.read[id] = Date.now(); save();
      toast('読了にしました（' + readCount() + ' / ' + KB.CHAPTERS.length + '章）');
      if (next) location.hash = '#/c/' + next.id; else viewChapter(id);
    };
    if (secIdx != null) {
      var el = document.getElementById('s' + secIdx);
      if (el) setTimeout(function () { el.scrollIntoView(); }, 0);
    }
  }

  /* ───── 画面：クイズ ───── */
  var quiz = null;
  function viewQuizMenu() {
    setPage('クイズ', null); setTab('quiz');
    function best(k) { return state.best[k] != null ? '前回のベスト ' + state.best[k] + '点' : 'まだ挑戦していません'; }
    var cats = [
      ['all', '全分野から10問', 'all'], ['law', '取適法', 'law'], ['fuso', '三菱ふそう', 'fuso'], ['buy', '購買', 'buy']
    ];
    var html = '<section class="sec"><h2 class="sec-h">4択クイズ（10問）</h2><ul class="panel rows">' + cats.map(function (c) {
      var count = KB.QUIZ.filter(function (q) { return c[2] === 'all' || q.c === c[2]; }).length;
      return '<li><a class="row" href="#/quiz/q/' + c[0] + '"><span class="tx"><span class="tt">' + esc(c[1]) + '</span><span class="ts">' + Math.min(10, count) + '問／全' + count + '問から出題・' + best(c[0]) + '</span></span>' + chev() + '</a></li>';
    }).join('') + '</ul></section>';
    html += '<section class="sec"><h2 class="sec-h">ケース判定（OK・NG）</h2><ul class="panel rows"><li><a class="row" href="#/quiz/case">' +
      '<span class="tx"><span class="tt">この対応、OK？NG？</span><span class="ts">実際の場面に近い' + KB.CASES.length + '問・' + best('case') + '</span></span>' + chev() + '</a></li></ul>' +
      '<p class="small muted" style="margin:8px 2px">ケースは学習用に作った例です。実際の判断は法務部門に確認してください。</p></section>';
    main.innerHTML = html;
  }
  function startQuiz(cat) {
    var pool = cat === 'case'
      ? KB.CASES.map(function (c) { return { s: c.s, okAns: c.ok, e: c.e, kind: 'case' }; })
      : KB.QUIZ.filter(function (q) { return cat === 'all' || q.c === cat; });
    pool = shuffle(pool).slice(0, cat === 'case' ? pool.length : 10);
    quiz = { cat: cat, items: pool.map(function (q) {
      if (q.kind === 'case') return q;
      var order = shuffle(q.a.map(function (_, i) { return i; }));
      return { q: q.q, a: order.map(function (i) { return q.a[i]; }), r: order.indexOf(q.r), e: q.e };
    }), i: 0, score: 0, log: [] };
    drawQuiz();
  }
  function drawQuiz() {
    var title = quiz.cat === 'case' ? 'ケース判定' : 'クイズ';
    setPage(title, '#/quiz'); setTab('quiz');
    if (quiz.i >= quiz.items.length) return drawQuizResult();
    var it = quiz.items[quiz.i], L = 'ABCD';
    var html = '<div class="qhead"><span>' + (quiz.i + 1) + ' / ' + quiz.items.length + '問</span><span>正解 ' + quiz.score + '</span></div>' +
      '<div class="bar" aria-hidden="true"><i style="width:' + Math.round(quiz.i / quiz.items.length * 100) + '%"></i></div>';
    if (it.kind === 'case') {
      html += '<div class="panel qtext" style="margin-top:14px">' + esc(it.s) + '</div>' +
        '<div class="okng"><button class="choice" type="button" data-v="1">OK</button><button class="choice" type="button" data-v="0">NG</button></div>';
    } else {
      html += '<div class="panel qtext" style="margin-top:14px">' + esc(it.q) + '</div><div class="choices">' +
        it.a.map(function (a, i) { return '<button class="choice" type="button" data-v="' + i + '"><span class="lt">' + L[i] + '</span><span>' + esc(a) + '</span></button>'; }).join('') + '</div>';
    }
    html += '<div id="fb"></div>';
    main.innerHTML = html;
    main.querySelectorAll('.choice').forEach(function (b) { b.onclick = function () { answer(+b.dataset.v); }; });
    var first = main.querySelector('.choice'); if (first) first.focus({ preventScroll: true });
  }
  function answer(v) {
    var it = quiz.items[quiz.i];
    var right = it.kind === 'case' ? (v === 1) === it.okAns : v === it.r;
    var rightIdx = it.kind === 'case' ? (it.okAns ? 1 : 0) : it.r;
    if (right) quiz.score++;
    quiz.log.push({ text: it.kind === 'case' ? it.s : it.q, right: right, e: it.e });
    main.querySelectorAll('.choice').forEach(function (b) {
      b.disabled = true;
      var bv = +b.dataset.v;
      if (bv === rightIdx) b.classList.add('right');
      else if (bv === v) b.classList.add('wrong');
    });
    var last = quiz.i + 1 >= quiz.items.length;
    var ans = it.kind === 'case' ? (it.okAns ? 'OK' : 'NG') : 'ABCD'[it.r];
    document.getElementById('fb').innerHTML = '<div class="explain ' + (right ? 'r' : 'w') + '" role="status"><b>' + (right ? '正解' : '不正解（答え：' + ans + '）') + '</b>' + esc(it.e) + '</div>' +
      '<div class="ch-foot"><button class="btn primary" type="button" id="nextQ">' + (last ? '結果を見る' : '次の問題') + '</button></div>';
    var nb = document.getElementById('nextQ');
    nb.onclick = function () { quiz.i++; drawQuiz(); window.scrollTo(0, 0); };
    nb.focus({ preventScroll: true });
    nb.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function drawQuizResult() {
    var total = quiz.items.length, pts = Math.round(quiz.score / total * 100);
    var prev = state.best[quiz.cat];
    if (prev == null || pts > prev) { state.best[quiz.cat] = pts; save(); }
    var msg = pts === 100 ? '満点です。自信を持って現場へ。' : pts >= 80 ? 'よくできています。間違えたところだけ見直しましょう。' : pts >= 50 ? 'あと少し。解説を読んでもう一度。' : 'マニュアルを読んでから、もう一度挑戦しましょう。';
    var html = '<div class="panel score"><div class="big">' + pts + '<small> 点</small></div><p class="muted">' + total + '問中 ' + quiz.score + '問正解' +
      (prev != null && pts > prev ? '・ベスト更新' : '') + '</p><p style="margin-top:8px">' + msg + '</p></div>';
    html += '<section class="sec"><h2 class="sec-h">ふりかえり</h2><ul class="panel pad review">' + quiz.log.map(function (l) {
      return '<li><span class="mk ' + (l.right ? 'r">○' : 'w">×') + '</span>' + esc(l.text) + '<div class="muted small">' + esc(l.e) + '</div></li>';
    }).join('') + '</ul></section>';
    html += '<div class="ch-foot"><button class="btn primary" type="button" id="again">もう一度</button><a class="btn" href="#/quiz">クイズのメニューへ</a></div>';
    main.innerHTML = html;
    var cat = quiz.cat;
    document.getElementById('again').onclick = function () { startQuiz(cat); window.scrollTo(0, 0); };
  }

  /* ───── 画面：ツール ───── */
  function viewTools() {
    setPage('ツール', null); setTab('tools');
    main.innerHTML = '<section class="sec"><h2 class="sec-h">取適法</h2><ul class="panel rows">' +
      '<li><a class="row" href="#/tools/scope"><span class="tx"><span class="tt">対象判定（目安）</span><span class="ts">取引の種類と、両社の資本金・従業員数から判定</span></span>' + chev() + '</a></li>' +
      '<li><a class="row" href="#/tools/check"><span class="tx"><span class="tt">発注チェックリスト</span><span class="ts">発注前・発注時・受領時・支払時・記録の5場面</span></span>' + chev() + '</a></li>' +
      '</ul></section>' +
      '<section class="sec"><h2 class="sec-h">すぐ読み返す</h2><ul class="panel rows">' +
      ['law-duty', 'law-ban', 'law-price', 'buy-flow'].map(function (id) {
        var c = chapterById(id);
        return '<li><a class="row" href="#/c/' + id + '"><span class="tx"><span class="tt">' + esc(c.title) + '</span><span class="ts">第' + chapterNo(id) + '章</span></span>' + chev() + '</a></li>';
      }).join('') + '</ul></section>';
  }

  function viewScope() {
    setPage('対象判定（目安）', '#/tools'); setTab('tools');
    var html = '<p class="muted small" style="margin:0 2px 12px">取適法の対象になるかの<strong>目安</strong>を出します。最終判断は法務部門と公正取引委員会の資料で確認してください。</p>' +
      '<form id="scopeForm" novalidate><fieldset class="sec" style="border:0"><legend class="sec-h">1. 取引の種類</legend><div class="seg">' +
      KB.SCOPE_TYPES.map(function (t, i) {
        return '<label><input type="radio" name="type" value="' + t.id + '"' + (i === 0 ? ' checked' : '') + '><span><b>' + esc(t.name) + '</b><small>' + esc(t.note) + '</small></span></label>';
      }).join('') + '</div></fieldset>' +
      '<div class="sec panel party"><h3>2. 頼む側（委託する会社）</h3>' +
      '<label class="field"><span class="lb">資本金</span><span class="unit"><input class="input" id="c1" inputmode="decimal" placeholder="例：35000000"><span>万円</span></span>' +
      '<span class="hint"><button class="link-btn" type="button" id="fusoCap" style="min-height:32px;padding:0">三菱ふそうの資本金（350億円）を入れる</button></span></label>' +
      '<label class="field"><span class="lb">従業員数</span><span class="unit"><input class="input" id="e1" inputmode="numeric" placeholder="常時使用する従業員の数"><span>人</span></span>' +
      '<span class="hint">分からなければ空欄で（資本金だけで判定）</span></label></div>' +
      '<div class="sec panel party"><h3>3. 受ける側（仕入先・委託先）</h3>' +
      '<label class="chk"><input type="checkbox" id="ind"><span>個人（個人事業主）</span></label>' +
      '<label class="field"><span class="lb">資本金</span><span class="unit"><input class="input" id="c2" inputmode="decimal" placeholder="例：5000"><span>万円</span></span></label>' +
      '<label class="field"><span class="lb">従業員数</span><span class="unit"><input class="input" id="e2" inputmode="numeric" placeholder="常時使用する従業員の数"><span>人</span></span>' +
      '<span class="hint">分からなければ空欄で</span></label></div>' +
      '<div class="ch-foot"><button class="btn primary" type="submit">判定する</button></div></form><div id="scopeOut" aria-live="polite"></div>';
    main.innerHTML = html;
    document.getElementById('fusoCap').onclick = function () { document.getElementById('c1').value = '3500000'; };
    var ind = document.getElementById('ind');
    ind.onchange = function () { document.getElementById('c2').disabled = ind.checked; document.getElementById('e2').disabled = ind.checked; };
    document.getElementById('scopeForm').onsubmit = function (ev) {
      ev.preventDefault();
      document.getElementById('scopeOut').innerHTML = judge();
      document.getElementById('scopeOut').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  }
  function num(id) {
    var v = document.getElementById(id).value.replace(/[,，\s]/g, '').replace(/[０-９．]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
    if (v === '') return null;
    var n = Number(v); return isFinite(n) && n >= 0 ? n : NaN;
  }
  function judge() {
    var type = document.querySelector('input[name="type"]:checked').value;
    var T = KB.SCOPE_TYPES.filter(function (t) { return t.id === type; })[0];
    var ind = document.getElementById('ind').checked;
    var c1 = num('c1'), e1 = num('e1'), c2 = ind ? null : num('c2'), e2 = ind ? null : num('e2');
    if ([c1, e1, c2, e2].some(function (x) { return x !== null && isNaN(x); })) return errBox('数字で入力してください（カンマは入れても大丈夫です）。');
    if (c1 === null && e1 === null) return errBox('頼む側の資本金か従業員数のどちらかを入れてください。');
    if (!ind && c2 === null && e2 === null) return errBox('受ける側の資本金か従業員数を入れるか、「個人」にチェックしてください。');
    var MAN = 1e4, high = T.capHigh, low = 1e7;
    var y1 = c1 === null ? null : c1 * MAN, y2 = c2 === null ? null : c2 * MAN;
    var reasons = [], unknown = [];
    // 資本金基準
    if (y1 !== null && (ind || y2 !== null)) {
      if (y1 > high && (ind || y2 <= high)) reasons.push('資本金基準：頼む側 ' + yen(high) + '超 → 受ける側 ' + (ind ? '個人' : yen(high) + '以下'));
      else if (y1 > low && y1 <= high && (ind || y2 <= low)) reasons.push('資本金基準：頼む側 1千万円超' + yen(high) + '以下 → 受ける側 ' + (ind ? '個人' : '1千万円以下'));
    } else unknown.push('資本金');
    // 従業員基準
    if (e1 !== null && (ind || e2 !== null)) {
      if (e1 > T.emp && (ind || e2 <= T.emp)) reasons.push('従業員基準：頼む側 ' + T.emp + '人超 → 受ける側 ' + (ind ? '個人' : T.emp + '人以下'));
    } else unknown.push('従業員数');
    var head = reasons.length ? '対象になる可能性が高い' : (unknown.length ? '入力した範囲では対象外。ただし未入力の基準あり' : '入力した範囲では対象外の可能性');
    var html = '<div class="result ' + (reasons.length ? 'yes' : 'no') + '"><h3>' + head + '</h3>';
    if (reasons.length) html += '<ul>' + reasons.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>' +
      '<p class="small" style="margin-top:8px">4つの義務と11の禁止行為を守って取引してください。</p>';
    if (unknown.length && !reasons.length) html += '<p class="small" style="margin-top:6px">' + esc(unknown.join('・')) + 'が分からないため、その基準では判定していません。もう一方の基準で対象になることがあります。</p>';
    html += '<p class="small muted" style="margin-top:8px">目安です。取引の種類の当てはめ（自社で使う物か、請け負った物か等）や、基準の細かな適用関係で結論が変わることがあります。法務部門に確認してください。</p></div>' +
      '<div class="ch-foot"><a class="btn" href="#/c/law-scope">「対象になる取引と会社」を読む</a></div>';
    return html;
  }
  function yen(v) { return v >= 1e8 ? (v / 1e8) + '億円' : (v / 1e7) + '千万円'; }
  function errBox(m) { return '<div class="result no" role="alert"><h3>入力を確認してください</h3><p class="small">' + esc(m) + '</p></div>'; }

  function viewCheck() {
    setPage('発注チェックリスト', '#/tools'); setTab('tools');
    var html = '<p class="muted small" style="margin:0 2px 4px">取適法と購買の基本にもとづくチェック項目です。チェックはこの端末に保存されます。案件ごとに「この場面をリセット」で消せます。</p>';
    html += KB.CHECKS.map(function (g) {
      var done = g.items.filter(function (_, i) { return state.checks[g.id + ':' + i]; }).length;
      return '<section class="sec"><h2 class="sec-h">' + esc(g.name) + '（<span data-count="' + g.id + '">' + done + '</span> / ' + g.items.length + '）</h2><div class="panel pad">' +
        g.items.map(function (t, i) {
          return '<label class="chk"><input type="checkbox" data-chk="' + g.id + '" data-i="' + i + '"' + (state.checks[g.id + ':' + i] ? ' checked' : '') + '><span>' + esc(t) + '</span></label>';
        }).join('') + '<button class="link-btn" type="button" data-reset="' + g.id + '">この場面をリセット</button></div></section>';
    }).join('');
    main.innerHTML = html;
    bindChecks();
    main.querySelectorAll('[data-reset]').forEach(function (b) {
      b.onclick = function () {
        var g = b.dataset.reset;
        Object.keys(state.checks).forEach(function (k) { if (k.indexOf(g + ':') === 0) delete state.checks[k]; });
        save(); viewCheck(); toast('リセットしました');
      };
    });
  }
  function bindChecks() {
    main.querySelectorAll('input[data-chk]').forEach(function (cb) {
      cb.onchange = function () {
        var k = cb.dataset.chk + ':' + cb.dataset.i;
        if (cb.checked) state.checks[k] = 1; else delete state.checks[k];
        save();
        var cnt = main.querySelector('[data-count="' + cb.dataset.chk + '"]');
        if (cnt) cnt.textContent = main.querySelectorAll('input[data-chk="' + cb.dataset.chk + '"]:checked').length;
      };
    });
  }

  /* ───── 画面：用語・出典 ───── */
  function viewWords() {
    setPage('用語・出典', null); setTab('words');
    var html = '<div class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>' +
      '<label for="gq" style="position:absolute;left:-999px">用語を絞り込む</label>' +
      '<input class="input" id="gq" type="search" placeholder="用語を絞り込む（例：遅延、4M）" autocomplete="off"></div>' +
      '<section class="sec"><h2 class="sec-h">用語集（' + KB.GLOSSARY.length + '語）</h2><dl class="panel gl" id="gl"></dl></section>' +
      '<section class="sec"><h2 class="sec-h">出典一覧</h2><div class="panel src" style="margin-top:0"><ol>' +
      Object.keys(KB.SOURCES).map(function (k) { var s = KB.SOURCES[k]; return '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.name) + '</a></li>'; }).join('') +
      '</ol><p style="margin-top:8px">内容は2026年11月時点で確認したものです。法令の正式な条文は e-Gov法令検索、運用は公正取引委員会の最新資料で確認してください。</p></div></section>';
    main.innerHTML = html;
    var inp = document.getElementById('gq'), gl = document.getElementById('gl');
    function draw() {
      var q = inp.value.trim().toLowerCase();
      var list = KB.GLOSSARY.filter(function (g) { return !q || (g[0] + g[1]).toLowerCase().indexOf(q) >= 0; });
      gl.innerHTML = list.length ? list.map(function (g) { return '<dt>' + esc(g[0]) + '</dt><dd>' + esc(g[1]) + '</dd>'; }).join('')
        : '<div class="empty">該当する用語がありません。</div>';
    }
    inp.addEventListener('input', draw); draw();
  }

  /* ───── ルーター ───── */
  function route() {
    var h = (location.hash || '#/').slice(1), p = h.split('/').filter(Boolean);
    window.scrollTo(0, 0);
    if (!p.length) viewHome();
    else if (p[0] === 'manual') viewManual();
    else if (p[0] === 'c') viewChapter(p[1], p[2] != null ? +p[2] : null);
    else if (p[0] === 'quiz' && p[1] === 'q') startQuiz(p[2] || 'all');
    else if (p[0] === 'quiz' && p[1] === 'case') startQuiz('case');
    else if (p[0] === 'quiz') viewQuizMenu();
    else if (p[0] === 'tools' && p[1] === 'scope') viewScope();
    else if (p[0] === 'tools' && p[1] === 'check') viewCheck();
    else if (p[0] === 'tools') viewTools();
    else if (p[0] === 'words') viewWords();
    else viewHome();
  }
  window.addEventListener('hashchange', route);
  route();

  /* ───── オフライン対応（http/https で開いたときだけ） ───── */
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
