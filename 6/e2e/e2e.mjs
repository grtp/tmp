// F-tool のブラウザ E2E(全機能のリグレッション一式)。
// 前提: backend(be_serve 相当)+ fe_serve + Edge headless(9223)起動済み。
import puppeteer from 'puppeteer-core';

const BASE = 'http://localhost:4200';

const results = [];
function check(name, cond) {
  results.push([cond ? 'PASS' : 'FAIL', name]);
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bodyText = (page) => page.evaluate(() => document.body.innerText);

// mat-select はオーバーレイ描画のため,トリガーをクリックして option を文言で選ぶ
async function pickMatSelect(page, trigger, optionText) {
  await page.click(trigger);
  await sleep(400);
  await clickByText(page, 'mat-option', optionText);
  await sleep(400);
}

async function clickByText(page, selector, text) {
  const handles = await page.$$(selector);
  for (const h of handles) {
    const t = await h.evaluate((el) => el.textContent?.trim() ?? '');
    if (t.includes(text)) {
      await h.click();
      return true;
    }
  }
  return false;
}

async function login(page, user, pass) {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(400);
  await page.evaluate(() => {
    // 前ユーザーの列幅などは残して良いが,テストを決定的にするためクリア
  });
  await page.type('input[type="text"]', user);
  await page.type('input[type="password"]', pass);
  await clickByText(page, 'button', 'ログイン');
  await page.waitForFunction(() => location.pathname === '/home', { timeout: 10000 });
  await sleep(600);
}

async function logout(page) {
  // ログアウトはヘッダーのユーザーメニュー(ドロワー)内にある
  await page.click('tm-user-menu .user-btn');
  await sleep(200);
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('tm-user-menu .drawer button')];
    btns.find((b) => b.textContent?.includes('ログアウト'))?.click();
  });
  await page.waitForFunction(() => location.pathname === '/login', { timeout: 10000 });
  await sleep(300);
}

/** filter-input / 検索ボックスに値を入れて Enter 適用 */
async function setAndEnter(page, selector, index, value) {
  await page.evaluate((selector, index, value) => {
    const el = document.querySelectorAll(selector)[index];
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }, selector, index, value);
}

/**
 * チップフィルタ(tm-filter-bar)に条件を1つ追加する。
 * value2 は op='range' の最大値。bool/enum 列は値が select になる。
 * フィルタ行は既定で非表示のため,無ければツールバーのじょうごから開始する
 * (じょうごは直接列選択ポップオーバーを開く)。
 */
async function addChipFilter(page, colLabel, op, value, value2) {
  if ((await page.$('tm-filter-bar .add')) !== null) {
    await page.click('tm-filter-bar .add');
  } else {
    await page.click('.filter-toggle');
  }
  await sleep(300);
  await page.evaluate((label) => {
    const items = [...document.querySelectorAll('tm-filter-bar .col-item')];
    items
      .find((b) => b.querySelector('.col-label')?.textContent?.trim() === label)
      ?.click();
  }, colLabel);
  await sleep(300);
  await page.evaluate((op, value) => {
    const pop = document.querySelector('tm-filter-bar .popover');
    const opSel = pop.querySelector('select.op');
    opSel.value = op;
    opSel.dispatchEvent(new Event('change', { bubbles: true }));
    const el = pop.querySelector('.inp.val');
    el.value = value;
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  }, op, value);
  await sleep(200);
  if (value2 !== undefined) {
    // range の2つ目の入力は op 変更後に現れる
    await page.evaluate((value2) => {
      const el = [...document.querySelectorAll('tm-filter-bar .popover .inp.val')][1];
      el.value = value2;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, value2);
  }
  await clickByText(page, 'tm-filter-bar .cond-foot button', '適用');
  await sleep(600);
}

/** チップフィルタを全解除する(チップが無ければ何もしない)。 */
async function clearChipFilters(page) {
  for (let i = 0; i < 25; i++) {
    const removed = await page.evaluate(() => {
      const b = document.querySelector('tm-filter-bar .chip-x');
      if (!b) return false;
      b.click();
      return true;
    });
    if (!removed) break;
    await sleep(400);
  }
}

const browser = await puppeteer.connect({
  browserURL: 'http://127.0.0.1:9223',
  defaultViewport: { width: 1400, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

try {
  // 0) 言語プルダウン(ログイン画面): en に切替で文言が変わり,ja に戻す
  await page.goto(BASE + '/login', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(400);
  await pickMatSelect(page, 'tm-lang-select mat-select', 'English');
  check('lang switch to English works', (await bodyText(page)).includes('Sign in'));
  await pickMatSelect(page, 'tm-lang-select mat-select', '日本語');
  check('lang switch back to ja works', (await bodyText(page)).includes('ログイン'));

  // 表示と実言語の一致: ftool.lang=en でリロードしてもプルダウンが English を指す
  // (旧実装は [value] バインディングの競合で「日本語」表示のまま英語UIになるバグ)
  await page.evaluate(() => localStorage.setItem('ftool.lang', 'en'));
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(500);
  const langState = await page.evaluate(() => ({
    selectLabel: document.querySelector('tm-lang-select mat-select')?.textContent?.trim(),
    bodyEn: document.body.innerText.includes('Sign in'),
  }));
  check('lang pulldown matches actual language after reload', langState.selectLabel === 'English' && langState.bodyEn);
  await page.evaluate(() => localStorage.setItem('ftool.lang', 'ja'));
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(500);

  // タイトルが F-tool になっている
  check('system name is F-tool', (await bodyText(page)).includes('F-tool'));
  // 妥当な XML であることも見る(コメント内の -- で SVG が壊れていた事故の回帰防止)
  check(
    'favicon.svg is served and is valid XML',
    await page.evaluate(async () => {
      const res = await fetch('/favicon.svg');
      if (!res.ok) return false;
      const doc = new DOMParser().parseFromString(await res.text(), 'image/svg+xml');
      return doc.querySelector('parsererror') === null && doc.documentElement.tagName === 'svg';
    }),
  );

  // 1) local(admin) ログイン → サイドバー構成と home
  await page.type('input[type="text"]', 'local');
  await page.type('input[type="password"]', 'Fidev01!');
  await clickByText(page, 'button', 'ログイン');
  await page.waitForFunction(() => location.pathname === '/home', { timeout: 10000 });
  await sleep(600);

  let text = await bodyText(page);
  check('sidebar has history + settings', /操作履歴/.test(text) && /設定/.test(text));
  check(
    'home lists granted functions',
    await page.evaluate(() => document.querySelectorAll('tm-home-container .entry').length >= 3),
  );

  // 1.5) ヘッダー: サイドバーにログアウト無し / ユーザー名ドロワー / タイトルでトップへ
  const sidebarLabels = await page.evaluate(() =>
    [...document.querySelectorAll('.menu-item')].map((b) => b.textContent?.trim() ?? ''),
  );
  check('sidebar has no logout item', !sidebarLabels.some((l) => l.includes('ログアウト')));
  await page.click('tm-user-menu .user-btn');
  await sleep(200);
  text = await bodyText(page);
  check('user drawer shows top + logout', /トップへ戻る/.test(text) && /ログアウト/.test(text));
  await page.mouse.click(400, 400); // ドロップダウンは外クリックで閉じる
  await sleep(200);
  check('user drawer closes on outside click', (await page.$('tm-user-menu .drawer')) === null);
  await page.goto(BASE + '/history', { waitUntil: 'networkidle2' });
  await sleep(400);
  // ヘッダーのブランド表示はサイドバー開閉トグル(遷移はしない)
  await page.click('.header-title');
  await sleep(400);
  check(
    'header brand toggles sidebar without navigating',
    (await page.evaluate(() => localStorage.getItem('ftool.sidebarCollapsed'))) === '1' &&
      (await page.evaluate(() => location.pathname)) === '/history',
  );
  await page.click('.header-title');
  await sleep(400);
  check(
    'header brand toggles sidebar back',
    (await page.evaluate(() => localStorage.getItem('ftool.sidebarCollapsed'))) === '0',
  );
  await page.goto(BASE + '/history', { waitUntil: 'networkidle2' });
  await sleep(400);
  await page.click('tm-user-menu .user-btn');
  await sleep(200);
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('tm-user-menu .drawer button')];
    btns.find((b) => b.textContent?.includes('トップへ戻る'))?.click();
  });
  await page.waitForFunction(() => location.pathname === '/home', { timeout: 10000 });
  check('drawer back-to-top returns to home', true);
  await sleep(500);


  // 5) bigdata: 件数カップ / 列フィルタ Enter / まとめて削除
  await page.goto(BASE + '/tables', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.body.innerText.includes('bigdata'), { timeout: 10000 });
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('button')];
    cards.find((c) => c.textContent?.includes('bigdata'))?.click();
  });
  // 2026-07-23 決定: 件数カップ(10,000+)廃止 → 正確な総件数が出る
  // (レコードの端数は実行間でドリフトしうるため「万単位の実数」を待つ)
  const FULL_COUNT = /1–50 \/ \d{2},\d{3}件/;
  await page.waitForFunction(
    (re) => new RegExp(re).test(document.body.innerText),
    { timeout: 15000 }, FULL_COUNT.source,
  );
  check('exact total count shown (no 10,000+ cap)', true);
  // 2026-08: カード遷移の URL は管理名(slug)を正とする
  check(
    'card navigation uses slug URL',
    await page.evaluate(() => location.pathname === '/tables/bigdata'),
  );

  // 列幅: 全実列は内容幅で固定,末尾の疑似カラム(フィラー)が余白を
  // 吸収して右端まで届く。実列とフィラーの間の区切り線は「意味の無い
  // 空列」に見えるため出さない(2026-08 デザイン改良で撤去)。
  const lastColFill = await page.evaluate(() => {
    const wrap = document.querySelector('.table-wrap');
    const table = document.querySelector('.table');
    const filler = document.querySelector('thead tr:first-child th[data-tm-filler]');
    const ths = [...document.querySelectorAll('thead tr:first-child th:not([data-tm-filler])')];
    if (!filler) return { fillerExists: false };
    const f = filler.getBoundingClientRect();
    const lastReal = ths[ths.length - 1];
    return {
      fillerExists: true,
      noHScroll: wrap.scrollWidth <= wrap.clientWidth + 1,
      fillerFillsRight: Math.abs(f.right - table.getBoundingClientRect().right) < 2 && f.width > 50,
      firstNarrow: ths[0].getBoundingClientRect().width < 200,
      // 実列の最終(val)とフィラーの間に区切り線(border-right)が無い
      noDivider: getComputedStyle(lastReal).borderRightWidth === '0px',
      fillerTds: document.querySelectorAll('tbody td[data-tm-filler]').length > 0,
      // フィラーは隣セルの clone なのでヘッダー色・sticky が実列と一致する
      bgMatch:
        getComputedStyle(filler).backgroundColor === getComputedStyle(lastReal).backgroundColor,
      sticky: getComputedStyle(filler).position === 'sticky',
    };
  });
  check(
    'filler pseudo-column absorbs remaining width (no divider)',
    lastColFill.fillerExists &&
      lastColFill.noHScroll &&
      lastColFill.fillerFillsRight &&
      lastColFill.firstNarrow &&
      lastColFill.noDivider &&
      lastColFill.fillerTds,
  );
  check(
    'filler header styled like real headers (bg + sticky)',
    lastColFill.bgMatch && lastColFill.sticky,
  );

  // 単独リサイズ: ドラッグした列だけが変わり,他列とテーブル全幅は不変
  // (伸縮はフィラーが引き受ける)
  const bigdataCols = () =>
    page.evaluate(() => {
      const ths = [...document.querySelectorAll('thead tr:first-child th:not([data-tm-filler])')];
      return {
        code: ths[1].getBoundingClientRect().width,
        val: ths[2].getBoundingClientRect().width,
        table: document.querySelector('.table').getBoundingClientRect().width,
      };
    });
  const pairBefore = await bigdataCols();
  const h2 = await page.evaluate(() => {
    const h = document.querySelectorAll('th [data-tm-resize-handle]')[1]; // code 列の右端
    const r = h.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(h2.x, h2.y);
  await page.mouse.down();
  await page.mouse.move(h2.x + 50, h2.y, { steps: 5 });
  await page.mouse.up();
  await sleep(300);
  const pairAfter = await bigdataCols();
  check(
    'resize changes only the dragged column (filler absorbs, table width unchanged)',
    Math.abs(pairAfter.code - pairBefore.code - 50) <= 2 &&
      Math.abs(pairAfter.val - pairBefore.val) <= 2 &&
      Math.abs(pairAfter.table - pairBefore.table) <= 2,
  );

  // ウィンドウ縮小(回帰シナリオ): フィラーが縮むだけで
  // 横スクロールは出ない。実列合計より狭くしたときだけ横スクロール。
  await page.setViewport({ width: 900, height: 760 });
  await sleep(500);
  const shrunk = await page.evaluate(() => {
    const wrap = document.querySelector('.table-wrap');
    return { noHScroll: wrap.scrollWidth <= wrap.clientWidth + 1 };
  });
  check('window shrink keeps table fit (filler shrinks, no h-scroll)', shrunk.noHScroll);
  await page.setViewport({ width: 1280, height: 760 });
  await sleep(500);

  // 後始末: 保存幅を消して autoFit 状態へ戻す(以降のテストに影響させない)
  await page.evaluate(() => localStorage.removeItem('ftool.colw:1:dbo.bigdata'));
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction((re) => new RegExp(re).test(document.body.innerText), { timeout: 15000 }, FULL_COUNT.source);

  // 表示件数の切替(10/20/50/100)
  await page.select('.page-size-select', '10');
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 10, { timeout: 10000 });
  check('page size 10 shows 10 rows', (await bodyText(page)).includes('1–10 /'));
  await page.select('.page-size-select', '50');
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 50, { timeout: 10000 });
  check('page size back to 50', true);

  // ページジャンプ: プルダウンで任意ページへ
  await page.select('.page-jump-select', '5');
  await page.waitForFunction(() => document.body.innerText.includes('201–250'), { timeout: 10000 });
  check('page jump select goes to page 5', true);
  await page.select('.page-jump-select', '1');
  await page.waitForFunction(() => document.body.innerText.includes('1–50'), { timeout: 10000 });

  // 複数選択モード: トグル中だけ[全選択]ボタンが出る(チェックボックス列は
  // 2026-08 に廃止。選択状態は行の左端アクセントで示す)
  check('select-all button hidden by default', (await page.$('.select-all')) === null);
  await page.click('.multi-toggle');
  await sleep(200);
  check('multi-select shows select-all button', (await page.$('.select-all')) !== null);
  await page.click('.multi-toggle');
  await sleep(200);
  check('toggling off hides select-all button', (await page.$('.select-all')) === null);

  // チップフィルタ: 旧フィルタ行は撤去済み。チップ行は条件が確定するまで
  // 視覚的に出ない(bare = 高さ0)。[フィルタ]ボタンで直接列選択が開く
  check('old filter row is gone', (await page.$('.filter-row')) === null);
  const bareState = await page.evaluate(() => {
    const row = document.querySelector('.filter-bar-row');
    return {
      bare: !!row?.classList.contains('bare'),
      height: row ? Math.round(row.getBoundingClientRect().height) : -1,
      addHidden: !document.querySelector('tm-filter-bar .add'),
    };
  });
  check(
    'filter bar invisible until a condition is applied',
    bareState.bare && bareState.height === 0 && bareState.addHidden,
  );
  await page.click('.filter-toggle');
  await sleep(400);
  check('filter button opens picker directly', (await page.$('tm-filter-bar .col-search')) !== null);
  // ポップオーバーは fixed で[フィルタ]ボタン中央の真下(パネル内にクランプ)
  const popPos = await page.evaluate(() => {
    const btn = document.querySelector('.filter-toggle').getBoundingClientRect();
    const panel = document.querySelector('.panel').getBoundingClientRect();
    const pop = document.querySelector('tm-filter-bar .popover');
    const r = pop.getBoundingClientRect();
    const wantCenter = btn.left + btn.width / 2;
    const centered = Math.abs(r.left + r.width / 2 - wantCenter) < 2;
    const clamped = r.right <= panel.right + 1 && r.left >= panel.left - 1;
    return {
      position: getComputedStyle(pop).position,
      underButton: Math.abs(r.top - (btn.bottom + 4)) < 2,
      centeredOrClamped: centered || clamped,
      insidePanelX: clamped,
    };
  });
  check(
    'picker is fixed under the filter button, clamped to the panel',
    popPos.position === 'fixed' && popPos.underButton && popPos.insidePanelX,
  );
  await page.keyboard.press('Escape');
  await sleep(400);
  check(
    'bar stays invisible when closed without applying',
    await page.evaluate(() =>
      Math.round(document.querySelector('.filter-bar-row').getBoundingClientRect().height) === 0,
    ),
  );

  // code 部分一致で絞込
  await addChipFilter(page, 'code', 'contains', 'B-0012');
  await page.waitForFunction(() => document.body.innerText.includes('10件'), { timeout: 10000 });
  const firstCode = await page.evaluate(
    () => document.querySelector('tbody tr')?.querySelectorAll('td')[1]?.textContent?.trim(),
  );
  check('chip filter (code contains B-0012 -> 10 rows)', firstCode === 'B-00120');

  // 適用中チップの表記と × 解除
  const chipText = await page.evaluate(() =>
    document.querySelector('tm-filter-bar .chip-body')?.textContent?.trim(),
  );
  check('chip shows column and value', chipText === 'code: B-0012');
  await page.click('tm-filter-bar .chip-x');
  await page.waitForFunction((re) => new RegExp(re).test(document.body.innerText), { timeout: 10000 }, FULL_COUNT.source);
  check('chip remove restores full count', (await page.$('tm-filter-bar .chip')) === null);

  // 演算子つきの述語: val > 97 は各百の位の 98/99 のみ = 300 行
  await addChipFilter(page, 'val', 'gt', '97');
  await page.waitForFunction(() => document.body.innerText.includes('300件'), { timeout: 10000 });
  check('operator predicate (val > 97 -> 300 rows)', true);
  // チップクリックで編集ポップオーバーが値入りで開く
  await page.click('tm-filter-bar .chip-body');
  await sleep(300);
  const editState = await page.evaluate(() => {
    const pop = document.querySelector('tm-filter-bar .popover');
    return {
      op: pop?.querySelector('select.op')?.value,
      value: pop?.querySelector('.inp.val')?.value,
    };
  });
  check('chip click reopens prefilled editor', editState.op === 'gt' && editState.value === '97');
  await page.keyboard.press('Escape');
  await sleep(200);
  await clearChipFilters(page);
  await page.waitForFunction((re) => new RegExp(re).test(document.body.innerText), { timeout: 10000 }, FULL_COUNT.source);

  // sticky ヘッダー: テーブル内部スクロールでもヘッダーが見えている
  const sticky = await page.evaluate(() => {
    const wrap = document.querySelector('.table-wrap');
    wrap.scrollTop = 500;
    const th = document.querySelector('thead th');
    return Math.abs(th.getBoundingClientRect().top - wrap.getBoundingClientRect().top) < 2;
  });
  check('table header is sticky while scrolling', sticky);

  // セル省略時のみホバーで title(overflow-title ディレクティブ)。
  // 列を極端に狭めてオーバーフローさせ,ホバーで title 付与,
  // 広げ直すとホバーで title が外れることを確認する。
  const overflowTitle = await page.evaluate(() => {
    const col = document.querySelectorAll('colgroup col')[1]; // code 列
    const td = document.querySelector('tbody tr td:nth-child(2)');
    const cellText = td.textContent.trim();
    col.style.width = '20px';
    const r1 = td.getBoundingClientRect();
    td.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: r1.x + 2, clientY: r1.y + 2 }));
    const narrow = { overflow: td.scrollWidth > td.clientWidth, title: td.title };
    col.style.width = '300px';
    const r2 = td.getBoundingClientRect();
    td.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: r2.x + 2, clientY: r2.y + 2 }));
    const wide = { overflow: td.scrollWidth > td.clientWidth, hasTitle: td.hasAttribute('title') };
    return { cellText, narrow, wide };
  });
  check(
    'overflow-title shows tooltip only when the cell text is truncated',
    overflowTitle.narrow.overflow && overflowTitle.narrow.title === overflowTitle.cellText &&
      !overflowTitle.wide.overflow && !overflowTitle.wide.hasTitle,
  );

  // 5b) まとめて削除: 行チェック → ボタン出現 → confirm(キャンセル/OK)
  // 実行ごとに一意な code を使う(失敗時の残骸が他の実行に混ざらないように)。
  // id は IDENTITY(readonly)のため insert に含めない。
  const uniq = `E2E${Date.now() % 1000000}`;
  const insertStatus = await page.evaluate(async (uniq) => {
    // URL は slug(管理名)のことがあるため,一覧 API で内部 id へ解決する
    const seg = location.pathname.split('/').pop();
    const id = /^\d+$/.test(seg)
      ? Number(seg)
      : (await fetch('/api/v1/managed-tables').then((x) => x.json())).tables.find(
          (t) => t.slug === seg,
        )?.id;
    const res = await fetch(`/api/v1/managed-tables/${id}/rows/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inserts: [
          { code: `${uniq}-1`, val: 1 },
          { code: `${uniq}-2`, val: 2 },
        ],
      }),
    });
    return res.status;
  }, uniq);
  check('bulk-delete fixture rows inserted', insertStatus === 200);

  await addChipFilter(page, 'code', 'contains', uniq);
  await page.waitForFunction(
    (uniq) => document.querySelectorAll('tbody tr').length === 2 && document.body.innerText.includes(uniq),
    { timeout: 10000 },
    uniq,
  );
  check('bulk delete button hidden without selection', (await page.$('.bulk-delete')) === null);

  await page.click('.multi-toggle'); // 複数選択モードへ
  await sleep(200);
  await page.click('.select-all'); // 全選択
  await sleep(200);
  const bulkLabel = await page.evaluate(() => document.querySelector('.bulk-delete')?.textContent?.trim());
  // 2026-08: ラベルは「まとめて削除(n)」から「削除(n)」へ短縮
  check('bulk delete button appears with count', bulkLabel?.includes('削除') && bulkLabel?.includes('2'));

  // 動的ボタンは固定ボタン群(CSV出力)の左側に出る(既存ボタンがずれない)
  check(
    'dynamic buttons appear left of fixed buttons',
    await page.evaluate(() => {
      const bulk = document.querySelector('.bulk-delete');
      const fixed = document.querySelector('.csv-export');
      return !!bulk && !!fixed &&
        !!(bulk.compareDocumentPosition(fixed) & Node.DOCUMENT_POSITION_FOLLOWING);
    }),
  );

  // キャンセル: 削除されない
  await page.click('.bulk-delete');
  await sleep(300);
  check('bulk confirm asks 削除しますか', (await bodyText(page)).includes('削除しますか'));
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('tm-confirm-dialog button')];
    btns.find((b) => b.textContent?.trim() === 'キャンセル')?.click();
  });
  await sleep(300);
  check('bulk cancel keeps rows', (await page.$$('tbody tr')).length === 2);
  check('bulk cancel keeps selection', (await page.$('.bulk-delete')) !== null);

  // OK: 削除される(キャンセル後も選択は残っているのでそのまま実行)
  await page.click('.bulk-delete');
  await sleep(300);
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('tm-confirm-dialog button')];
    btns.find((b) => b.textContent?.trim() === 'OK')?.click();
  });
  await page.waitForFunction(() => document.body.innerText.includes('該当するデータがありません'), { timeout: 10000 });
  check('bulk OK deletes selected rows', true);
  await clearChipFilters(page); // フィルタ解除して後続テストへ
  await page.waitForFunction((re) => new RegExp(re).test(document.body.innerText), { timeout: 10000 }, FULL_COUNT.source);

  // ============================= CSV 出力 =============================
  // ダウンロードは URL.createObjectURL を横取りして Blob 内容を検証する。
  // BOM 判定のため生バイト(arrayBuffer)で見る(blob.text() は先頭 BOM を
  // UTF-8 decode 仕様で除去してしまうため text では判定できない)。
  await page.evaluate(() => {
    window.__csvTexts = [];
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b) => {
      if (b instanceof Blob) {
        b.arrayBuffer().then((ab) => {
          const u8 = new Uint8Array(ab);
          const hasBom = u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf;
          const text = new TextDecoder('utf-8').decode(u8); // BOM は ﻿ として残る
          window.__csvTexts.push({ text, hasBom });
        });
      }
      return orig(b);
    };
  });

  // 表示範囲出力(BOM なし)。選択 0 件なので選択範囲出力は無効
  await page.click('.csv-export');
  await sleep(300);
  check('csv export dialog opens', (await bodyText(page)).includes('Excel互換'));
  check(
    'selection export disabled without selection',
    await page.evaluate(() => document.querySelectorAll('tm-csv-export-dialog .entry')[0]?.disabled === true),
  );
  await clickByText(page, 'tm-csv-export-dialog button.entry', '表示範囲出力');
  await page.waitForFunction(() => window.__csvTexts.length === 1, { timeout: 10000 });
  const csvPage = await page.evaluate(() => window.__csvTexts[0]);
  check(
    'page export: header + 50 rows, no BOM',
    !csvPage.hasBom && csvPage.text.startsWith('id,code,val') && csvPage.text.trim().split('\n').length === 51,
  );

  // 全件出力(チップフィルタの述語適用 + Excel互換 = BOM 付き)
  await addChipFilter(page, 'code', 'contains', 'B-0012');
  await page.waitForFunction(() => document.body.innerText.includes('10件'), { timeout: 10000 });
  await page.click('.csv-export');
  await sleep(300);
  await page.evaluate(() => {
    const cb = document.querySelector('tm-csv-export-dialog input[type="checkbox"]');
    if (!cb.checked) cb.click();
  });
  await clickByText(page, 'tm-csv-export-dialog button.entry', '全件出力');
  await page.waitForFunction(() => window.__csvTexts.length === 2, { timeout: 15000 });
  const csvAll = await page.evaluate(() => window.__csvTexts[1]);
  check(
    'all export: BOM + filtered rows from server',
    csvAll.hasBom && csvAll.text.includes('B-00120') && csvAll.text.trim().split('\n').length === 11,
  );
  await clearChipFilters(page);
  await page.waitForFunction((re) => new RegExp(re).test(document.body.innerText), { timeout: 10000 }, FULL_COUNT.source);

  // 選択範囲出力(2 行チェック,Excel互換 OFF に戻す)。複数選択モード中は
  // 行クリック自体が選択トグル(チェックボックス列は 2026-08 に廃止)。
  await page.evaluate(() => {
    const rows = document.querySelectorAll('tbody tr');
    rows[0].click();
    rows[1].click();
  });
  await page.click('.csv-export');
  await sleep(300);
  await page.evaluate(() => {
    const cb = document.querySelector('tm-csv-export-dialog input[type="checkbox"]');
    if (cb.checked) cb.click();
  });
  await clickByText(page, 'tm-csv-export-dialog button.entry', '選択範囲出力');
  await page.waitForFunction(() => window.__csvTexts.length === 3, { timeout: 10000 });
  const csvSel = await page.evaluate(() => window.__csvTexts[2]);
  check(
    'selection export: exactly 2 checked rows',
    !csvSel.hasBom && csvSel.text.includes('B-00001') && csvSel.text.trim().split('\n').length === 3,
  );

  // ================= ドラッグ範囲選択(実マウス) =================
  await page.evaluate(() => {
    [...document.querySelectorAll('tr.checked')].forEach((tr) => tr.click());
  });
  const rowCenter = (idx) =>
    page.evaluate((idx) => {
      const r = document.querySelectorAll('tbody tr')[idx].getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, idx);
  const pA = await rowCenter(0);
  const pB = await rowCenter(4);
  await page.mouse.move(pA.x, pA.y);
  await page.mouse.down();
  await page.mouse.move(pB.x, pB.y, { steps: 8 });
  await page.mouse.up();
  await sleep(300);
  check('drag range selects 5 rows', (await page.$$('tr.checked')).length === 5);
  check('drag does not open edit dialog', (await page.$('tm-row-edit-dialog')) === null);

  // 別の未選択範囲をドラッグすると,前回の選択を消さずに追加される
  // (2026-08 変更: 以前は毎回ドラッグ範囲で全置換していた)
  const pC = await rowCenter(10);
  const pD = await rowCenter(12);
  await page.mouse.move(pC.x, pC.y);
  await page.mouse.down();
  await page.mouse.move(pD.x, pD.y, { steps: 8 });
  await page.mouse.up();
  await sleep(300);
  check(
    'dragging a new range adds to (not replaces) the existing selection',
    (await page.$$('tr.checked')).length === 8, // 0-4(5) + 10-12(3)
  );

  // 既に選択済みの行を起点にドラッグすると,その範囲だけが解除される
  // (選択範囲外の行はそのまま残る)
  const pE = await rowCenter(1);
  const pF = await rowCenter(3);
  await page.mouse.move(pE.x, pE.y);
  await page.mouse.down();
  await page.mouse.move(pF.x, pF.y, { steps: 8 });
  await page.mouse.up();
  await sleep(300);
  check(
    'dragging from an already-selected row deselects that range only',
    (await page.$$('tr.checked')).length === 5, // 8 - 1..3(3) = 5(0,4,10,11,12)
  );

  // 複数選択モード中は行クリック = 選択トグル(編集ダイアログは開かない)
  await page.evaluate(() => {
    [...document.querySelectorAll('tr.checked')].forEach((tr) => tr.click());
  });
  const p3 = await rowCenter(2);
  await page.mouse.click(p3.x, p3.y);
  await sleep(200);
  check(
    'row click toggles selection in multi mode',
    (await page.$$('tr.checked')).length === 1 &&
      (await page.$('tm-row-edit-dialog')) === null,
  );
  await page.mouse.click(p3.x, p3.y);
  await sleep(200);
  check('row click again deselects', (await page.$$('tr.checked')).length === 0);
  await page.click('.multi-toggle'); // モード解除(選択破棄)
  await sleep(200);

  // ============================= CSV 取込 =============================
  await page.goto(BASE + '/tables', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.body.innerText.includes('コードマスタ'), { timeout: 10000 });
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('button')];
    cards.find((c) => c.textContent?.includes('コードマスタ'))?.click();
  });
  await page.waitForFunction(() => document.body.innerText.includes('C-001'), { timeout: 10000 });

  // 行編集の[複製](2026-07-24): PK 以外をコピーして新規作成ドラフトへ切替。
  // codes は自然キー(code=PK)なので「ID を変えて複製」のユースケースそのもの。
  const dupUniq = `DUP${Date.now() % 100000}`;
  await page.evaluate(() => {
    const tr = [...document.querySelectorAll('tbody tr')].find((r) => r.textContent?.includes('C-001'));
    tr?.querySelector('td')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await sleep(400);
  check('row edit dialog opens on row click', (await page.$('tm-row-edit-dialog')) !== null);
  await clickByText(page, 'tm-row-edit-dialog button', '複製');
  await sleep(300);
  const dupState = await page.evaluate(() => {
    const dlg = document.querySelector('tm-row-edit-dialog');
    const title = dlg?.querySelector('.head-title')?.textContent?.trim() ?? '';
    const inputs = [...dlg.querySelectorAll('input.input')]; // 列順: code, name, val
    return { title, code: inputs[0]?.value ?? '?', name: inputs[1]?.value ?? '?' };
  });
  check(
    'duplicate switches to create draft (PK cleared, values copied)',
    dupState.title.includes('行の追加') && dupState.code === '' && dupState.name === 'コード1',
  );
  // 新しい PK を入れて保存 → 新規行として登録される
  await page.evaluate((v) => {
    const el = document.querySelector('tm-row-edit-dialog').querySelectorAll('input.input')[0];
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, dupUniq);
  await clickByText(page, 'tm-row-edit-dialog button', '保存');
  await page.waitForFunction((v) => document.body.innerText.includes(v), { timeout: 10000 }, dupUniq);
  check('duplicated row saved as a new row', true);
  // 後始末: 複製で作った行を削除して元の3件へ戻す
  await page.evaluate(async (v) => {
    // URL は slug(管理名)のことがあるため,一覧 API で内部 id へ解決する
    const seg = location.pathname.split('/').pop();
    const id = /^\d+$/.test(seg)
      ? Number(seg)
      : (await fetch('/api/v1/managed-tables').then((x) => x.json())).tables.find(
          (t) => t.slug === seg,
        )?.id;
    await fetch(`/api/v1/managed-tables/${id}/rows/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deletes: [{ key: { code: v } }] }),
    });
  }, dupUniq);
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.body.innerText.includes('C-001'), { timeout: 10000 });

  const csvUniq = `E4${Date.now() % 100000}`;
  const injectCsv = (csvText) =>
    page.evaluate((csvText) => {
      const file = new File([csvText], 'import.csv', { type: 'text/csv' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.querySelector('.file-input');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, csvText);

  // 未知列 -> エラーバナーで中止(マージ画面は開かない)
  await injectCsv('code,nope\r\nX-1,1\r\n');
  await sleep(400);
  check(
    'unknown column aborts import',
    (await page.evaluate(() => document.querySelector('p.error')?.textContent ?? '')).includes('nope') &&
      (await page.$('tm-csv-merge-dialog')) === null,
  );

  // 正常 + 重複(C-001) + 型エラー(val=xx) の混在
  const csvBody = `code,name,val\r\nC-001,重複,99\r\n${csvUniq}-1,新規A,1\r\n${csvUniq}-2,新規B,xx\r\n${csvUniq}-3,新規C,3\r\n`;
  await injectCsv(csvBody);
  await sleep(500);
  check('merge dialog opens', (await page.$('tm-csv-merge-dialog')) !== null);
  check('conflict row shown red', (await page.$$('tm-csv-merge-dialog .row.conflict')).length === 1);
  check('invalid row shown orange', (await page.$$('tm-csv-merge-dialog .row.type-error')).length === 1);
  check('invalid-row wording (無効な行)', (await bodyText(page)).includes('無効な行'));

  // 行 2-3 をドラッグ選択して[選択行を排除]
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('tm-csv-merge-dialog .row')];
    rows[1].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    rows[2].dispatchEvent(new PointerEvent('pointerenter'));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
  await sleep(200);
  await clickByText(page, 'tm-csv-merge-dialog button', '選択行を排除');
  await sleep(200);
  check('remove selected works (drag range)', (await page.$$('tm-csv-merge-dialog .row')).length === 2);

  // キャンセル → 再取込 → [重複を排除]で赤行が消える
  await clickByText(page, 'tm-csv-merge-dialog button', 'キャンセル');
  await sleep(200);
  await injectCsv(csvBody);
  await sleep(500);
  await clickByText(page, 'tm-csv-merge-dialog button', '重複を排除');
  await sleep(200);
  check(
    'remove conflicts works',
    (await page.$$('tm-csv-merge-dialog .row')).length === 3 &&
      (await page.$$('tm-csv-merge-dialog .row.conflict')).length === 0,
  );

  // [適応]: 型エラー行は自動排除され (*)行 2 つが先頭に付く
  await clickByText(page, 'tm-csv-merge-dialog button', '適応');
  await sleep(400);
  check(
    'pending rows appear first with * in first column',
    await page.evaluate(() => {
      const pend = [...document.querySelectorAll('tbody tr.pending')];
      return (
        pend.length === 2 &&
        pend[0] === document.querySelector('tbody tr') &&
        pend.every((tr) => tr.querySelector('td .pending-mark')?.textContent?.trim() === '*')
      );
    }),
  );

  // まとめて保存: (*)行を選択して保存 → DB 反映((*)が消える)
  await page.click('.multi-toggle');
  await sleep(200);
  await page.click('.select-all');
  await sleep(200);
  const saveLabel = await page.evaluate(() => document.querySelector('.save-pending')?.textContent?.trim());
  check('save-pending appears with count', saveLabel?.includes('まとめて保存') && saveLabel?.includes('2'));
  await page.click('.save-pending');
  await page.waitForFunction(
    (u) => document.querySelectorAll('tbody tr.pending').length === 0 && document.body.innerText.includes(`${u}-1`),
    { timeout: 10000 },
    csvUniq,
  );
  check('save pending inserts rows into DB', true);

  // 重複を残して保存 → 409(取込 N 行目)で全ロールバック,(*)行は残る
  await injectCsv('code,name,val\r\nC-001,重複,99\r\n');
  await sleep(500);
  await clickByText(page, 'tm-csv-merge-dialog button', '適応');
  await sleep(300);
  await page.click('.select-all');
  await sleep(200);
  await page.click('.save-pending');
  await sleep(800);
  const dupErr = await page.evaluate(() => document.querySelector('p.error')?.textContent ?? '');
  check('duplicate save rejected with row number', dupErr.includes('重複') && dupErr.includes('取込 1 行目'));
  check('pending row kept after rollback', (await page.$$('tbody tr.pending')).length === 1);

  // (*)行のまとめて削除 = ローカル破棄(API を呼ばない)
  await page.evaluate(() => {
    [...document.querySelectorAll('tr.checked')].forEach((tr) => tr.click());
    document.querySelectorAll('tbody tr')[0].click();
  });
  await sleep(200);
  await page.click('.bulk-delete');
  await sleep(300);
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('tm-confirm-dialog button')];
    btns.find((b) => b.textContent?.trim() === 'OK')?.click();
  });
  await sleep(400);
  check('pending row locally discarded', (await page.$$('tbody tr.pending')).length === 0);

  // クリーンアップ(取り込んだ 2 行を API で削除)
  const cleanupStatus = await page.evaluate(async (u) => {
    // URL は slug(管理名)のことがあるため,一覧 API で内部 id へ解決する
    const seg = location.pathname.split('/').pop();
    const id = /^\d+$/.test(seg)
      ? Number(seg)
      : (await fetch('/api/v1/managed-tables').then((x) => x.json())).tables.find(
          (t) => t.slug === seg,
        )?.id;
    const res = await fetch(`/api/v1/managed-tables/${id}/rows/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deletes: [{ key: { code: `${u}-1` } }, { key: { code: `${u}-3` } }] }),
    });
    return res.status;
  }, csvUniq);
  check('cleanup imported rows', cleanupStatus === 200);

  // ============== 多列テーブル(20列)の横スクロール ==============
  await page.goto(BASE + '/tables', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.body.innerText.includes('ワイドテーブル'), { timeout: 10000 });
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((c) => c.textContent?.includes('ワイドテーブル'))?.click();
  });
  await page.waitForFunction(
    () => document.querySelectorAll('thead tr:first-child th:not([data-tm-filler])').length === 20 &&
      document.querySelectorAll('tbody tr').length === 50,
    { timeout: 15000 },
  );
  check('wide table renders 20 columns', true);
  const wideScroll = await page.evaluate(() => {
    const wrap = document.querySelector('.table-wrap');
    const before = wrap.scrollLeft;
    wrap.scrollLeft = 99999;
    return { canScroll: wrap.scrollWidth > wrap.clientWidth, scrolled: wrap.scrollLeft > before };
  });
  check('wide table scrolls horizontally', wideScroll.canScroll && wideScroll.scrolled);
  const wideSticky = await page.evaluate(() => {
    const wrap = document.querySelector('.table-wrap');
    wrap.scrollTop = 300;
    const th = document.querySelector('thead th');
    return Math.abs(th.getBoundingClientRect().top - wrap.getBoundingClientRect().top) < 2;
  });
  check('wide table header sticky while h+v scrolling', wideSticky);

  // 6) 履歴画面: 列幅ドラッグ → localStorage → リロードで維持
  await page.goto(BASE + '/history', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length > 0, { timeout: 10000 });
  await page.evaluate(() => localStorage.removeItem('ftool.colw:history'));
  const handleBox = await page.evaluate(() => {
    const h = document.querySelectorAll('th [data-tm-resize-handle]')[1];
    const r = h.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(handleBox.x, handleBox.y);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + 60, handleBox.y, { steps: 5 });
  await page.mouse.up();
  await sleep(300);
  const stored = await page.evaluate(() => localStorage.getItem('ftool.colw:history'));
  check('column resize stored for history table', stored !== null && stored.includes(':'));
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length > 0, { timeout: 10000 });
  // 履歴のチップフィルタ(結果は enum。旧フィルタ行は撤去済み)
  check('history old filter row is gone', (await page.$('.filter-row')) === null);
  await addChipFilter(page, '結果', 'eq', 'failure');
  // 失敗のみ NG バッジで表示される(成功は控えめなテキスト .result-ok)
  await page.waitForFunction(
    () => {
      const b = [...document.querySelectorAll('tbody .badge.ng')];
      return b.length > 0 && b.every((x) => x.textContent.trim() === 'NG') &&
        document.querySelectorAll('tbody .result-ok').length === 0;
    },
    { timeout: 10000 },
  );
  check('history result filter (enum) works', true);
  check('history filter chip shown', (await page.$('tm-filter-bar .chip')) !== null);
  await clearChipFilters(page);
  await sleep(500);
  check('history chip remove clears filter', (await page.$('tm-filter-bar .chip')) === null);

  // 行クリックで detail が展開され,再クリックで折りたたまれる(共有グリッドの expand-row)
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('tbody tr')].find((r) => r.textContent?.includes('rows.'));
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await sleep(400);
  check('history row click expands detail', (await page.$('.expand-row .detail')) !== null);
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('tbody tr')].find((r) => r.textContent?.includes('rows.'));
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await sleep(400);
  check('history row click again collapses detail', (await page.$('.expand-row')) === null);

  // 履歴の CSV 出力(2026-07-24: テーブル管理と同じ3スコープのダイアログに)
  await page.evaluate(() => {
    window.__csvTexts = [];
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b) => {
      if (b instanceof Blob) b.text().then((t) => window.__csvTexts.push(t));
      return orig(b);
    };
  });
  // 全件出力(サーバー生成。BOM なし・JST ヘッダー・summary/detail 列)
  await page.click('.csv-export');
  await sleep(300);
  check(
    'history csv dialog: selection export disabled without selection',
    await page.evaluate(() => document.querySelectorAll('tm-csv-export-dialog .entry')[0]?.disabled === true),
  );
  await clickByText(page, 'tm-csv-export-dialog button.entry', '全件出力');
  await page.waitForFunction(() => window.__csvTexts.length === 1, { timeout: 15000 });
  const histCsv = await page.evaluate(() => window.__csvTexts[0]);
  check(
    'history CSV all export: JST header + summary/detail columns, no BOM',
    !histCsv.startsWith('﻿') &&
      histCsv.startsWith('occurred_at_jst,') &&
      histCsv.includes(',summary,') &&
      histCsv.includes('detail'),
  );

  // 表示範囲出力(クライアント生成。summary はサーバー導出のため列に無い)。
  // detail は画面表示用に整形済み(改行入り)の JSON だが,全件出力(サーバー
  // 生成,json.Marshal によるコンパクト1行)と体裁を揃えるためコンパクトに
  // 詰め直している(2026-07-24 修正: 詰め直し忘れで改行入りのまま出力され,
  // 1レコードが複数行に見えていた不具合)。よってレコード行数 = 表示行数。
  const pageRowCount = await page.evaluate(() => document.querySelectorAll('tbody tr:not(.expand-row)').length);
  await page.click('.csv-export');
  await sleep(300);
  await clickByText(page, 'tm-csv-export-dialog button.entry', '表示範囲出力');
  await page.waitForFunction(() => window.__csvTexts.length === 2, { timeout: 10000 });
  const histCsvPage = await page.evaluate(() => window.__csvTexts[1]);
  const histCsvPageLines = histCsvPage.trim().split(/\r?\n/);
  check(
    'history CSV page export: client header without summary column',
    histCsvPageLines[0] ===
      'occurred_at_jst,username,action_code,operation,target,result,error_code,client_ip,detail',
  );
  check(
    'history CSV page export: detail JSON compacted (no embedded newlines, 1 line per row)',
    histCsvPageLines.length === pageRowCount + 1,
  );

  // 複数選択: ドラッグ範囲選択(2026-08 からチェックボックス列は廃止。
  // 選択状態は行の左端アクセントで示す)
  await page.click('.multi-toggle');
  await sleep(200);
  check('history multi-select shows select-all button', (await page.$('.select-all')) !== null);

  const histRowCenter = (i) =>
    page.evaluate((i) => {
      const r = document.querySelectorAll('tbody tr:not(.expand-row)')[i].getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, i);
  const hA = await histRowCenter(0);
  const hB = await histRowCenter(3);
  await page.mouse.move(hA.x, hA.y);
  await page.mouse.down();
  await page.mouse.move(hB.x, hB.y, { steps: 8 });
  await page.mouse.up();
  await sleep(300);
  check('history drag range selects 4 rows', (await page.$$('tr.checked')).length === 4);
  check('history drag does not expand detail row', (await page.$('.expand-row')) === null);

  // チェック解除してから2行だけチェックし,選択範囲出力を検証
  await page.evaluate(() => {
    [...document.querySelectorAll('tr.checked')].forEach((tr) => tr.click());
  });
  await page.evaluate(() => {
    const rows = document.querySelectorAll('tbody tr:not(.expand-row)');
    rows[0].click();
    rows[1].click();
  });
  await page.click('.csv-export');
  await sleep(300);
  await clickByText(page, 'tm-csv-export-dialog button.entry', '選択範囲出力');
  await page.waitForFunction(() => window.__csvTexts.length === 3, { timeout: 10000 });
  const histCsvSel = await page.evaluate(() => window.__csvTexts[2]);
  check(
    'history CSV selection export: exactly 2 checked rows',
    histCsvSel.trim().split(/\r?\n/).length === 3, // header + 2 rows
  );
  // ダイアログが完全に閉じる(overlay が後始末クリックを奪わない)まで待つ。
  await page.waitForFunction(
    () => document.querySelector('tm-csv-export-dialog') === null,
    { timeout: 10000 },
  );
  await page.click('.multi-toggle'); // 後始末: 複数選択を解除
  await sleep(200);
  check('history multi-select turned off (select-all button gone)', (await page.$('.select-all')) === null);

  // 操作(部分一致)のチップフィルタ
  await addChipFilter(page, '操作', 'contains', 'rows.export');
  await page.waitForFunction(
    () => {
      const ops = [...document.querySelectorAll('tbody tr:not(.expand-row) td:nth-child(4)')];
      return ops.length > 0 && ops.every((td) => td.textContent.includes('rows.export'));
    },
    { timeout: 10000 },
  );
  check('history operation filter (contains) works', true);

  // 日付(以上)のチップ。JST の1日境界で解釈される(サーバー側検証済み)
  await addChipFilter(page, '日時 (JST)', 'gte', '2026-07-10');
  await sleep(400);
  check('history date chip appears', (await bodyText(page)).includes('2026-07-10'));

  // [すべて解除](チップ2件以上で表示される)
  await page.evaluate(() => document.querySelector('tm-filter-bar .clear')?.click());
  await sleep(600);
  check('history clear-all removes chips', (await page.$('tm-filter-bar .chip')) === null);

  const colWidths = await page.evaluate(() =>
    [...document.querySelectorAll('colgroup col')].map((c) => c.style.width),
  );
  check('column width reapplied after reload', colWidths.some((w) => w !== ''));

  // 7) 設定 > 機能設定(機能マスタ): settings 行は disabled のチェックで固定表示(操作不可) + API 409
  await page.goto(BASE + '/settings/functions', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.body.innerText.includes('tables'), { timeout: 10000 });
  const settingsRow = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('tbody tr')];
    const row = rows.find((r) => r.textContent?.includes('settings'));
    const cb = row?.querySelector('input[type="checkbox"]');
    return {
      hasCheckbox: !!cb,
      disabled: cb?.disabled === true,
      checked: cb?.checked === true,
    };
  });
  check('settings row enabled checkbox is disabled', settingsRow.hasCheckbox && settingsRow.disabled);
  check('settings row checkbox stays checked', settingsRow.checked === true);

  const patchStatus = await page.evaluate(async () => {
    const res = await fetch('/api/v1/admin/actions', { headers: { Accept: 'application/json' } });
    const { actions } = await res.json();
    const s = actions.find((a) => a.code === 'settings');
    const patch = await fetch(`/api/v1/admin/actions/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    return patch.status;
  });
  check('API rejects settings disable with 409', patchStatus === 409);

  // 7.5) 個人設定(ユーザーメニュー > 個人設定): 時計設定(なし/分/秒/フォーマット)。
  // ユーザーごとに保持する設定なので API も /me/settings。
  await page.goto(BASE + '/home', { waitUntil: 'networkidle2' });
  await sleep(600);
  // 前回実行の残骸に依存しないよう,既定(分)を明示してから始める
  await page.evaluate(async () => {
    await fetch('/api/v1/me/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ headerClock: 'minute', headerClockFormat: '' }),
    });
  });
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(600);
  check(
    'header clock has no seconds by default',
    /^\d{2}:\d{2}$/.test(
      await page.evaluate(
        () => document.querySelector('.header-right .clock-time')?.textContent?.trim() ?? '',
      ),
    ),
  );
  await page.click('tm-user-menu .user-btn');
  await sleep(300);
  check(
    'user menu has personal settings under back-to-top',
    await page.evaluate(() => {
      const items = [...document.querySelectorAll('tm-user-menu .drawer .item')];
      const top = items.findIndex((b) => b.textContent?.includes('トップへ戻る'));
      const personal = items.findIndex((b) => b.textContent?.includes('個人設定'));
      return top >= 0 && personal === top + 1;
    }),
  );
  await clickByText(page, 'tm-user-menu .drawer .item', '個人設定');
  await sleep(400);
  check(
    'personal settings dialog opens',
    (await bodyText(page)).includes('時計設定'),
  );
  // バージョン表記は "ver: <IMAGE_TAG>"(dev サーバーでは ver: dev)
  check(
    'personal settings shows version as ver:',
    await page.evaluate(() =>
      document.querySelector('tm-personal-settings-dialog .version')
        ?.textContent?.trim().startsWith('ver: ') ?? false),
  );

  // [秒]: 保存され,リロード無しでヘッダーへ反映される(同じストア)
  await clickByText(page, 'tm-personal-settings-dialog .seg button', '秒');
  await sleep(1300);
  const personalSecond = await page.evaluate(async () => {
    const saved = await fetch('/api/v1/me/settings').then((r) => r.json());
    return {
      saved: saved.headerClock,
      shown: document.querySelector('.header-right .clock-time')?.textContent?.trim() ?? '',
    };
  });
  check('clock mode [second] is saved', personalSecond.saved === 'second');
  check(
    'header clock shows seconds immediately after switching',
    /^\d{2}:\d{2}:\d{2}$/.test(personalSecond.shown),
  );

  // [なし]: ヘッダーから時計が消える
  await clickByText(page, 'tm-personal-settings-dialog .seg button', 'なし');
  await sleep(600);
  check(
    'clock mode [none] hides the header clock',
    await page.evaluate(() => document.querySelector('.header-right .clock') === null),
  );

  // [フォーマット]: 入力 → プレビュー即時反映,blur で保存されヘッダーが書式表示に
  await clickByText(page, 'tm-personal-settings-dialog .seg button', 'フォーマット');
  await sleep(400);
  await page.evaluate(() => {
    const el = document.querySelector('tm-personal-settings-dialog .format-in');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, 'yyyy/MM/dd (E) HH:mm:ss');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(200);
  check(
    'format preview updates live',
    /\d{4}\/\d{2}\/\d{2} \(.\) \d{2}:\d{2}:\d{2}/.test(
      await page.evaluate(
        () => document.querySelector('tm-personal-settings-dialog .preview')?.textContent ?? '',
      ),
    ),
  );
  await page.evaluate(() => {
    document.querySelector('tm-personal-settings-dialog .format-in')
      ?.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(1300);
  check(
    'custom format is saved and rendered in the header',
    /^\d{4}\/\d{2}\/\d{2} \(.\) \d{2}:\d{2}:\d{2}$/.test(
      await page.evaluate(
        () => document.querySelector('.header-right .clock-time')?.textContent?.trim() ?? '',
      ),
    ),
  );

  // (?)ヘルプ: トークンと置換結果のペアが並ぶ
  await page.click('tm-personal-settings-dialog .help-btn');
  await sleep(200);
  check(
    'format help lists token examples (fixed 1970/01/23 14:56:43)',
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('tm-personal-settings-dialog .help-table tr')];
      const val = (tok) => rows.find((r) => r.querySelector('.tok')?.textContent === tok)
        ?.querySelector('.val')?.textContent ?? '';
      return rows.length >= 15 && val('yyyy') === '1970' && val('HH') === '14' &&
        val('mm') === '56' && val('ss') === '43' && val('E') === '金';
    }),
  );

  // 元に戻して閉じる(以降のテストと手動確認のため既定=分へ)
  await clickByText(page, 'tm-personal-settings-dialog .seg button', '分');
  await sleep(900);
  check(
    'clock mode back to [minute]',
    (await page.evaluate(() =>
      fetch('/api/v1/me/settings').then((r) => r.json()).then((s) => s.headerClock),
    )) === 'minute',
  );
  await clickByText(page, 'tm-personal-settings-dialog .foot button', '閉じる');
  await sleep(300);


  // 8.6) サイドバー「テーブル管理」/ テーブルカード / 列モード / 前後値
  // 列モードの検証は demo.dbo.audit_demo(id=6, phone=除外, updated_at=編集不可)
  // を登録済みであることに依存する。
  await page.goto(BASE + '/home', { waitUntil: 'networkidle2' });
  await sleep(600);
  const sideMenu = await page.evaluate(() =>
    [...document.querySelectorAll('.menu-item')].map((b) => b.textContent?.trim() ?? ''),
  );
  check('sidebar has tables item', sideMenu.some((m) => m.includes('テーブル管理')));
  await clickByText(page, '.menu-item', 'テーブル管理');
  await page.waitForFunction(() => location.pathname === '/tables', { timeout: 10000 });
  check('sidebar tables navigates to select page', true);

  // 8.6a) テーブル選択画面の見た目改良(検索/表示切替/メタ情報/空状態)
  await page.goto(BASE + '/tables', { waitUntil: 'networkidle2' });
  await sleep(700);
  check(
    'table cards show registered/last-activity meta line',
    await page.evaluate(() =>
      [...document.querySelectorAll('.card .card-meta')].some((m) => m.textContent?.includes('登録'))),
  );
  const cardCountBefore = await page.evaluate(() => document.querySelectorAll('.card').length);
  await page.type('.search-in', 'コード');
  await sleep(300);
  check(
    'search narrows the card list to matching tables only',
    await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.card .card-name')];
      return cards.length === 1 && (cards[0].textContent?.includes('コード') ?? false);
    }) && cardCountBefore > 1,
  );
  check(
    'no-match search shows the empty message, not stale cards',
    (await page.evaluate(async () => {
      const el = document.querySelector('.search-in');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, 'この文字列には一致しません_zzz');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
      return document.querySelectorAll('.card').length === 0;
    })),
  );
  await page.evaluate(() => {
    const el = document.querySelector('.search-in');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(300);

  // 表示切替(カード/リスト)。選択は端末に永続化されるのでリロード後も維持される
  await page.click('.view-toggle button[aria-label*="リスト"]');
  await sleep(300);
  check(
    'view toggle switches to list layout',
    await page.evaluate(() =>
      document.querySelector('.list') !== null && document.querySelector('.cards') === null),
  );
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(600);
  check(
    'view choice persists across reload (localStorage)',
    await page.evaluate(() => document.querySelector('.list') !== null),
  );
  await page.click('.view-toggle button[aria-label*="カード"]');
  await sleep(300);

  // 列モード: 監査デモのグリッドに phone が無く updated_at はある
  await page.goto(BASE + '/tables/audit_demo', { waitUntil: 'networkidle2' });
  await sleep(900);
  const gridHeaders = await page.evaluate(() =>
    [...document.querySelectorAll('thead th')].map((th) => th.textContent?.trim() ?? ''),
  );
  check(
    'hidden column excluded from grid, readonly column shown',
    !gridHeaders.some((h) => h.includes('phone')) && gridHeaders.some((h) => h.includes('updated_at')),
  );

  // 前後値: 直近の rows.batch(成功)のうち update/delete を含むものに before がある
  // (insert のみのバッチは changes を持たないため直近 20 件から探す)
  const auditHasBefore = await page.evaluate(async () => {
    const r = await fetch('/api/v1/history?limit=20&operation=rows.batch&result=success').then(
      (x) => x.json(),
    );
    return r.entries.some((e) => {
      const chg = e.detail?.changes;
      return Array.isArray(chg) && chg.length > 0 && chg[0].before && chg[0].key;
    });
  });
  check('rows.batch audit records before/after', auditHasBefore);


  // 新規グレーアウト: 監査デモ(6)の必須列 name を一時的に除外して確認 → 戻す
  await page.evaluate(async () => {
    await fetch('/api/v1/managed-tables/6', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hiddenColumns: ['phone', 'name'] }),
    });
  });
  await page.goto(BASE + '/tables/audit_demo', { waitUntil: 'networkidle2' });
  await sleep(900);
  const createBtn = await page.evaluate(() => {
    const b = document.querySelector('.toolbar .create');
    return b ? { disabled: b.disabled, title: b.title } : null;
  });
  check(
    'create button greyed out with reason when required column hidden',
    !!createBtn && createBtn.disabled && createBtn.title.includes('name'),
  );
  await page.evaluate(async () => {
    await fetch('/api/v1/managed-tables/6', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hiddenColumns: ['phone'] }),
    });
  });

  // 8.7b) グリッドの見た目改良(商品マスタ: price/stock 数値, updated_at 日時)
  await page.goto(BASE + '/tables/products', { waitUntil: 'networkidle2' });
  await sleep(900);
  check(
    'numeric columns are right-aligned with a mono value cell',
    await page.evaluate(() => {
      const priceTh = [...document.querySelectorAll('th')].find((th) => th.textContent?.includes('price'));
      const priceTd = document.querySelector('tbody tr td:nth-child(5)');
      return (priceTh?.classList.contains('num') ?? false) &&
        (priceTd?.classList.contains('num') ?? false) && (priceTd?.classList.contains('mono') ?? false);
    }),
  );
  check(
    'datetime cell is rounded to seconds (no fractional digits, no timezone)',
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(
      await page.evaluate(() => document.querySelector('tbody tr td:nth-child(7)')?.textContent?.trim() ?? ''),
    ),
  );
  check(
    'header row is sticky (stays fixed while scrolling)',
    (await page.evaluate(() =>
      getComputedStyle(document.querySelector('thead th')).position)) === 'sticky',
  );
  check(
    'single-page table hides the page-jump/page-size pickers',
    await page.evaluate(() =>
      document.querySelector('.page-jump-select') === null &&
      document.querySelector('.page-size-select') === null &&
      document.querySelector('.pager') !== null),
  );

  // ソート: ヘッダーは直接クリックできない(操作は[ソート]ボタンへ集約)
  check(
    'header is not directly clickable for sorting (no cursor/handler)',
    await page.evaluate(() => {
      const th = [...document.querySelectorAll('th')].find((t) => t.textContent?.includes('price'));
      return !th.classList.contains('sortable') && getComputedStyle(th).cursor !== 'pointer';
    }),
  );

  // [ソート]ボタン → 列一覧ポップオーバー(フィルタと同じ見た目: 検索欄+一覧)
  // → price を選ぶ → 昇順→降順が実際に行を並べ替える。適用中はヘッダー下部の
  // タグ(フィルタのチップと同型)に出て,本体クリックで再編集・×で解除できる。
  const pickPriceSort = async () => page.evaluate(async () => {
    const btns = [...document.querySelectorAll('.sort-popover .col-item')];
    btns.find((b) => b.textContent?.includes('price'))?.click();
    await new Promise((r) => setTimeout(r, 400));
    return [...document.querySelectorAll('tbody tr td:nth-child(5)')].map((td) => td.textContent?.trim());
  });
  await page.click('.sort-toggle');
  await sleep(250);
  check(
    'sort popover lists sortable columns',
    await page.evaluate(() =>
      document.querySelector('.sort-popover .col-search') !== null &&
      [...document.querySelectorAll('.sort-popover .col-item')].some((b) => b.textContent?.includes('price'))),
  );
  const asc = await pickPriceSort();
  check(
    'picking a column from the sort popover applies ascending order and closes it',
    await page.evaluate(() =>
      document.querySelector('.sort-popover') === null &&
      (document.querySelector('.sort-chip .chip-body')?.textContent?.includes('price') ?? false)),
  );
  await page.click('.sort-chip .chip-body'); // タグ本体クリックで再度開く → 同じ列で降順トグル
  await sleep(250);
  const desc = await pickPriceSort();
  check(
    'picking the same column again toggles to descending (exact reverse of ascending)',
    asc.length === 5 &&
      JSON.stringify(asc) === JSON.stringify([...desc].reverse()) &&
      asc[0] !== desc[0],
  );
  check(
    'active sort column shows the highlighted arrow icon in the header',
    await page.evaluate(() => {
      const th = [...document.querySelectorAll('th')].find((t) => t.textContent?.includes('price'));
      return th?.querySelector('.sort-ic.active') !== null;
    }),
  );
  // タグの × で解除 → タグごと消える
  await page.click('.sort-chip .chip-x');
  await sleep(400);
  check('sort tag × clears the sort', (await page.$('.sort-chip')) === null);

  // 選択行(複数選択モード)は左端アクセント付きで視覚的に強調される
  await page.click('.toolbar .multi-toggle');
  await sleep(300);
  await page.click('tbody tr');
  await sleep(200);
  check(
    'checked row gets a left accent (inset box-shadow)',
    (await page.evaluate(() =>
      getComputedStyle(document.querySelector('tbody tr.checked')).boxShadow)) !== 'none',
  );
  await page.click('.toolbar .multi-toggle'); // モード解除(以降のテストへ影響させない)
  await sleep(300);

  // 8.8) 管理テーブルの行クリック → 編集ダイアログ(表示名/説明/列モード)
  await page.goto(BASE + '/settings/tables', { waitUntil: 'networkidle2' });
  await sleep(600);
  await clickByText(page, '.mat-mdc-tab-link', '管理テーブル');
  await sleep(500);
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('tbody tr')].find((tr) =>
      tr.textContent?.includes('コードマスタ'),
    );
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await sleep(1200);
  const editDlg = await page.evaluate(() => {
    const dlg = document.querySelector('tm-managed-table-dialog');
    const tr = [...(dlg?.querySelectorAll('table.cols tbody tr') ?? [])].find(
      (x) => x.querySelector('td')?.textContent?.trim() === 'val',
    );
    return {
      title: dlg?.querySelector('.head-title')?.textContent?.trim() ?? '',
      targetShown: !!dlg?.querySelector('.edit-target'),
      noCandidates: !dlg?.querySelector('.candidates'),
      displayName: dlg?.querySelector('.field .input')?.value ?? '',
      // .field-row 内の2番目の .field が管理名(slug)
      slug: [...(dlg?.querySelectorAll('.field .input') ?? [])][1]?.value ?? '',
      valMode: tr?.querySelector('select.mode-select')?.value ?? '',
    };
  });
  check(
    'table edit dialog opens with fixed target + current values',
    editDlg.title.includes('管理テーブルの編集') &&
      editDlg.targetShown &&
      editDlg.noCandidates &&
      editDlg.displayName === 'コードマスタ' &&
      editDlg.slug === 'codes' &&
      editDlg.valMode === 'edit',
  );
  // val を編集不可へ変更して保存 → meta に反映される
  await page.evaluate(() => {
    const dlg = document.querySelector('tm-managed-table-dialog');
    const tr = [...dlg.querySelectorAll('table.cols tbody tr')].find(
      (x) => x.querySelector('td')?.textContent?.trim() === 'val',
    );
    const sel = tr.querySelector('select.mode-select');
    sel.value = 'readonly';
    sel.dispatchEvent(new Event('change'));
    [...dlg.querySelectorAll('.foot button')].find((b) => b.textContent?.includes('保存'))?.click();
  });
  await sleep(1500);
  const editSaved = await page.evaluate(async () => {
    const tables = await fetch('/api/v1/managed-tables?all=true').then((x) => x.json());
    const codes = tables.tables.find((t) => t.tableName === 'codes');
    const meta = await fetch(`/api/v1/managed-tables/${codes.id}/meta`).then((x) => x.json());
    const val = meta.columns.find((c) => c.name === 'val');
    return { ro: codes.readonlyColumns ?? [], valReadonly: !!val?.readonly };
  });
  check(
    'table edit saves column modes (val -> readonly)',
    editSaved.ro.includes('val') && editSaved.valReadonly,
  );
  // 後始末: 元に戻す
  await page.evaluate(async () => {
    const tables = await fetch('/api/v1/managed-tables?all=true').then((x) => x.json());
    const codes = tables.tables.find((t) => t.tableName === 'codes');
    await fetch(`/api/v1/managed-tables/${codes.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ readonlyColumns: [] }),
    });
  });

  // 8.8a2) slug(管理名): /tables/<slug> で開ける。未知の slug は一覧へ戻る。
  // 形式違反/重複(大文字小文字無視)はサーバーが拒否する。
  await page.goto(BASE + '/tables/products', { waitUntil: 'networkidle2' });
  await sleep(800);
  check('slug URL opens the table', (await bodyText(page)).includes('商品マスタ'));
  await page.goto(BASE + '/tables/no-such-slug', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => location.pathname === '/tables', { timeout: 10000 });
  check('unknown slug falls back to the card list', true);
  // 数値 id の URL は無効(slug のみ有効。2026-08-05)
  await page.goto(BASE + '/tables/1', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => location.pathname === '/tables', { timeout: 10000 });
  check('numeric id URL is no longer valid (slug only)', true);
  const slugApi = await page.evaluate(async () => {
    const tables = await fetch('/api/v1/managed-tables?all=true').then((x) => x.json());
    const codes = tables.tables.find((t) => t.tableName === 'codes');
    const patch = (body) =>
      fetch(`/api/v1/managed-tables/${codes.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const dup = await patch({ slug: 'PRODUCTS' }); // CI 重複 -> 409
    const bad = await patch({ slug: '1abc' }); // 形式違反 -> 400
    return { slug: codes.slug, dupStatus: dup.status, badStatus: bad.status };
  });
  check(
    'slug in DTO + server rejects duplicate(CI) and invalid format',
    slugApi.slug === 'codes' && slugApi.dupStatus === 409 && slugApi.badStatus === 400,
  );

  // 8.8b) 固定値列 — 監査デモ(id=6)の updated_at を「保存時の現在時刻」へ
  // 切り替え,行更新でサーバーが自動セットすることを API 経由で検証 → 元に戻す
  const fixedResult = await page.evaluate(async () => {
    const patch = (body) =>
      fetch('/api/v1/managed-tables/6', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    // updated_at: readonly -> fixed(now, both)
    await patch({ readonlyColumns: [], fixedColumns: [{ name: 'updated_at', kind: 'now', applyOn: 'both' }] });
    const meta = await fetch('/api/v1/managed-tables/6/meta').then((x) => x.json());
    const col = meta.columns.find((c) => c.name === 'updated_at');
    // 1行目を取得して name を書き換え(updated_at はクライアントから送らない)
    const rows = await fetch('/api/v1/managed-tables/6/rows?limit=1&offset=0').then((x) => x.json());
    const row = rows.rows[0];
    const before = row.updated_at;
    const uniq = 'fx' + Date.now();
    const res = await fetch('/api/v1/managed-tables/6/rows/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        updates: [{ key: { id: row.id }, changes: { name: uniq } }],
      }),
    });
    const rows2 = await fetch('/api/v1/managed-tables/6/rows?limit=50&offset=0').then((x) => x.json());
    const after = rows2.rows.find((r) => r.id === row.id);
    // 後始末: name を戻し,列モードも readonly に戻す
    await fetch('/api/v1/managed-tables/6/rows/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates: [{ key: { id: row.id }, changes: { name: row.name } }] }),
    });
    await patch({ fixedColumns: [], readonlyColumns: ['updated_at'] });
    return {
      metaFixed: !!col?.fixed && !!col?.readonly,
      updateOk: res.ok,
      changed: !!after && after.updated_at !== before,
    };
  });
  check(
    'fixed column (now) auto-sets updated_at on row update',
    fixedResult.metaFixed && fixedResult.updateOk && fixedResult.changed,
  );

  // 8.8c) 除外+固定(S45) — 監査デモの phone(除外済み)に固定値を併用。
  // meta から列は消えたまま insert でサーバーが値を自動セットすることを検証。
  // 値の確認は一時的に除外を解除して行い,最後にシード状態へ戻す。
  const hiddenFixedResult = await page.evaluate(async () => {
    const patch = (body) =>
      fetch('/api/v1/managed-tables/6', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const uniq = 'hf' + Date.now();
    // phone: hidden -> hidden+fixed(literal, insert)
    const patched = await patch({
      hiddenColumns: ['phone'],
      fixedColumns: [{ name: 'phone', kind: 'literal', value: uniq, applyOn: 'insert' }],
    });
    const meta = await fetch('/api/v1/managed-tables/6/meta').then((x) => x.json());
    const phoneHidden = !meta.columns.some((c) => c.name === 'phone');
    const ins = await fetch('/api/v1/managed-tables/6/rows/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inserts: [{ name: uniq }] }),
    });
    // 除外を外して値を読めるようにする(固定値指定も解除)
    await patch({ hiddenColumns: [], fixedColumns: [] });
    const rows = await fetch('/api/v1/managed-tables/6/rows?limit=50&offset=0').then((x) => x.json());
    const row = rows.rows.find((r) => r.name === uniq);
    // 後始末: 挿入行を削除し,シード状態(phone 除外のみ)へ戻す
    if (row) {
      await fetch('/api/v1/managed-tables/6/rows/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deletes: [{ key: { id: row.id } }] }),
      });
    }
    await patch({ hiddenColumns: ['phone'] });
    return {
      patchOk: patched.ok,
      phoneHidden,
      insertOk: ins.ok,
      valueApplied: row?.phone === uniq,
    };
  });
  check(
    'hidden+fixed column stays hidden but auto-sets value on insert',
    hiddenFixedResult.patchOk &&
      hiddenFixedResult.phoneHidden &&
      hiddenFixedResult.insertOk &&
      hiddenFixedResult.valueApplied,
  );

  // 言語切替: 組込機能の名称が英語に追従する(home の機能リンクで確認)
  await page.goto(BASE + '/home', { waitUntil: 'networkidle2' });
  await sleep(700);
  await pickMatSelect(page, 'tm-lang-select mat-select', 'English');
  await sleep(600);
  const enCard = await page.evaluate(() =>
    [...document.querySelectorAll('tm-home-container .entry .name')].map((e) => e.textContent?.trim() ?? ''),
  );
  check('builtin function name follows language (home)', enCard.includes('Table management'));

  // 設定>ユーザー権限/機能タブでも組込機能名が言語切替に追従すること
  await page.goto(BASE + '/settings/users', { waitUntil: 'networkidle2' });
  await sleep(500);
  const usersHeaderText = await bodyText(page);
  check(
    'settings users tab: function names follow language (en)',
    usersHeaderText.includes('Table management') &&
      usersHeaderText.includes('History') &&
      !usersHeaderText.includes('テーブル管理'),
  );
  await page.goto(BASE + '/settings/functions', { waitUntil: 'networkidle2' });
  await sleep(500);
  const actionsTabText = await bodyText(page);
  check(
    'settings functions tab: function names follow language (en)',
    actionsTabText.includes('Table management') && !actionsTabText.includes('テーブル管理'),
  );

  await pickMatSelect(page, 'tm-lang-select mat-select', '日本語');
  await sleep(600);

  // 8.10) ヘッダーロゴ / サイドバー開閉
  await page.goto(BASE + '/home', { waitUntil: 'networkidle2' });
  await sleep(600);

  // サイドバー開閉に連動してヘッダーは テキストのみ/アイコンのみ を切り替える
  // (両方出すと F アイコン + F-tool で F が重複するため)
  check(
    'sidebar expanded by default: header text only, no icon',
    (await page.$('.header-title .brand-logo')) === null &&
      (await bodyText(page)).includes('F-tool'),
  );
  // ヘッダー時計: 言語切替の左に日付+時刻(HH:MM)を表示する
  const clock = await page.evaluate(() => {
    const el = document.querySelector('.header-right .clock');
    if (!el) return null;
    const lang = document.querySelector('.header-right tm-lang-select');
    return {
      date: el.querySelector('.clock-date')?.textContent?.trim() ?? '',
      time: el.querySelector('.clock-time')?.textContent?.trim() ?? '',
      // DOM 順で言語切替より前(= 左)にあること
      beforeLang: !!(lang && el.compareDocumentPosition(lang) & Node.DOCUMENT_POSITION_FOLLOWING),
    };
  });
  check(
    'header shows current date and time left of the language select',
    clock !== null &&
      /^\d{4}\/\d{2}\/\d{2}/.test(clock.date) &&
      /^\d{2}:\d{2}$/.test(clock.time) &&
      clock.beforeLang,
  );

  // ヘッダーの各要素(ブランド/時計/言語切替/ユーザー)は同じ高さで揃える
  // 高さは要素ごとに違ってよいが,中央線(centerY)は一致させる
  const headerCenters = await page.evaluate(() =>
    [
      '.header-title',
      '.header-right .clock',
      '.header-right .lang-field',
      '.header-right .user-btn',
    ].map((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.height > 0 ? r.top + r.height / 2 : null;
    }),
  );
  check(
    'header items are centered on the same line',
    headerCenters.every((c) => c !== null) &&
      Math.max(...headerCenters) - Math.min(...headerCenters) <= 1,
  );

  // FAB は真円(幅=高さ,角丸=50%)

  // 折りたたみボタンはサイドバー最下部(フッター)に張り付く
  const toggleAtBottom = await page.evaluate(() => {
    const nav = document.querySelector('.sidebar').getBoundingClientRect();
    const btn = document.querySelector('.sidebar-toggle').getBoundingClientRect();
    const lastItem = [...document.querySelectorAll('.menu-item')].pop().getBoundingClientRect();
    return { gap: nav.bottom - btn.bottom, belowMenu: btn.top - lastItem.bottom };
  });
  check(
    'sidebar toggle sits at the bottom of the sidebar',
    toggleAtBottom.gap >= 0 && toggleAtBottom.gap < 16 && toggleAtBottom.belowMenu > 16,
  );
  await page.click('.sidebar-toggle');
  await sleep(300);
  check(
    'sidebar collapsed: header shows icon only',
    (await page.$('.header-title .brand-logo')) !== null,
  );
  // mat-icon はリガチャ名をテキストとして持つため,アイコンを除いた本文で判定する
  const menuLabelsHidden = await page.evaluate(() =>
    [...document.querySelectorAll('.menu-item')].every((el) => {
      const clone = el.cloneNode(true);
      clone.querySelectorAll('mat-icon').forEach((i) => i.remove());
      return clone.textContent?.trim() === '';
    }),
  );
  check('sidebar collapsed: menu labels hidden', menuLabelsHidden);
  check(
    'sidebar collapse persisted to localStorage',
    (await page.evaluate(() => localStorage.getItem('ftool.sidebarCollapsed'))) === '1',
  );
  await page.click('.sidebar-toggle');
  await sleep(300);
  check(
    'sidebar re-expanded: header text restored, icon gone',
    (await page.$('.header-title .brand-logo')) === null &&
      (await bodyText(page)).includes('F-tool'),
  );

  // 8.11) 接続のスキーマ制限(ftool_app_connections.schema_name)。
  // fixture: 01_init.sql が demo DB に e2e_schema.e2e_only を用意済み。
  const restrictedConn = await page.evaluate(async () => {
    const res = await fetch('/api/v1/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'e2e-restricted', host: 'localhost', port: 1433, databaseName: 'demo',
        username: 'sa', password: 'Fidev01!', schemaName: 'e2e_schema',
      }),
    });
    return res.ok ? await res.json() : { error: await res.text(), status: res.status };
  });
  check('create schema-restricted connection', restrictedConn.schemaName === 'e2e_schema');

  // 接続一覧にスキーマ制限が表示される
  await page.goto(BASE + '/settings/tables', { waitUntil: 'networkidle2' });
  await sleep(600);
  await page.evaluate(() => {
    [...document.querySelectorAll('.mat-mdc-tab-link')].find((b) => b.textContent?.includes('接続'))?.click();
  });
  await sleep(500);
  const connRowText = await page.evaluate(() => {
    const tr = [...document.querySelectorAll('table.table tbody tr')].find((r) =>
      r.textContent?.includes('e2e-restricted'),
    );
    return tr ? tr.textContent.replace(/\s+/g, ' ').trim() : null;
  });
  check('connections list shows schema restriction', !!connRowText && connRowText.includes('e2e_schema'));

  // 編集ダイアログ: 現在値が入り,空にして保存すると制限解除される
  await page.evaluate(() => {
    const tr = [...document.querySelectorAll('table.table tbody tr')].find((r) =>
      r.textContent?.includes('e2e-restricted'),
    );
    tr?.dispatchEvent(new MouseEvent('click', { bubbles: true })); // 行クリック = 編集
  });
  await sleep(500);
  const schemaFieldInitial = await page.evaluate(() => {
    const dlg = document.querySelector('tm-connection-dialog');
    const input = [...dlg.querySelectorAll('.field .input')].find((i) =>
      i.closest('.field')?.textContent?.includes('スキーマ'),
    );
    return input?.value ?? null;
  });
  check('connection edit dialog shows current schema restriction', schemaFieldInitial === 'e2e_schema');
  await page.evaluate(() => {
    const dlg = document.querySelector('tm-connection-dialog');
    const input = [...dlg.querySelectorAll('.field .input')].find((i) =>
      i.closest('.field')?.textContent?.includes('スキーマ'),
    );
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await clickByText(page, 'tm-connection-dialog .foot button', '保存');
  await sleep(900);
  const clearedConn = await page.evaluate(async () => {
    const list = await fetch('/api/v1/connections').then((r) => r.json());
    return list.connections.find((c) => c.name === 'e2e-restricted');
  });
  check('clearing schema field removes the restriction', !clearedConn?.schemaName);
  // 以降のテストのため制限を戻す
  await page.evaluate(() => {
    const tr = [...document.querySelectorAll('table.table tbody tr')].find((r) =>
      r.textContent?.includes('e2e-restricted'),
    );
    tr?.dispatchEvent(new MouseEvent('click', { bubbles: true })); // 行クリック = 編集
  });
  await sleep(500);
  await page.evaluate(() => {
    const dlg = document.querySelector('tm-connection-dialog');
    const input = [...dlg.querySelectorAll('.field .input')].find((i) =>
      i.closest('.field')?.textContent?.includes('スキーマ'),
    );
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'e2e_schema');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await clickByText(page, 'tm-connection-dialog .foot button', '保存');
  await sleep(900);

  // 管理対象テーブルの登録ダイアログ: 制限付き接続を選ぶとスキーマ絞り込みが
  // 固定表示・入力無効化され,候補もそのスキーマだけになる
  await page.evaluate(() => {
    [...document.querySelectorAll('.mat-mdc-tab-link')].find((b) => b.textContent?.includes('管理テーブル'))?.click();
  });
  await sleep(500);
  await clickByText(page, 'button.add-btn', '追加');
  await sleep(500);
  await page.evaluate(() => {
    const dlg = document.querySelector('tm-managed-table-dialog');
    const select = dlg.querySelector('select.select');
    const opt = [...select.options].find((o) => o.textContent?.includes('e2e-restricted'));
    select.value = opt.value;
    select.dispatchEvent(new Event('change'));
  });
  await sleep(800);
  const restrictedDialogState = await page.evaluate(() => {
    const dlg = document.querySelector('tm-managed-table-dialog');
    const filterInput = dlg.querySelector('.filter.grow .input');
    const cands = [...dlg.querySelectorAll('ul.candidates .mono')].map((e) => e.textContent?.trim());
    return { filterValue: filterInput.value, filterDisabled: filterInput.disabled, cands };
  });
  check(
    'schema filter locked to the connection restriction',
    restrictedDialogState.filterValue === 'e2e_schema' && restrictedDialogState.filterDisabled,
  );
  check(
    'candidates limited to the restricted schema only',
    restrictedDialogState.cands.length > 0 &&
      restrictedDialogState.cands.every((c) => c.startsWith('e2e_schema.')),
  );
  // 既定DBに戻すと絞り込みが解除される
  await page.evaluate(() => {
    const dlg = document.querySelector('tm-managed-table-dialog');
    const select = dlg.querySelector('select.select');
    select.value = '';
    select.dispatchEvent(new Event('change'));
  });
  await sleep(800);
  const unlockedDialogState = await page.evaluate(() => {
    const dlg = document.querySelector('tm-managed-table-dialog');
    const filterInput = dlg.querySelector('.filter.grow .input');
    return { filterValue: filterInput.value, filterDisabled: filterInput.disabled };
  });
  check(
    'schema filter unlocked for the default connection',
    unlockedDialogState.filterValue === '' && !unlockedDialogState.filterDisabled,
  );
  await page.keyboard.press('Escape');
  await sleep(300);

  // backend: /schema/tables はユーザー指定の schema= より接続の制限を優先する
  const schemaTablesResp = await page.evaluate(async (connId) => {
    const res = await fetch(`/api/v1/schema/tables?connectionId=${connId}&schema=dbo`);
    return res.ok ? await res.json() : { error: await res.text(), status: res.status };
  }, restrictedConn.id);
  check(
    'schema/tables forces the restricted schema over the requested filter',
    Array.isArray(schemaTablesResp.tables) &&
      schemaTablesResp.tables.length > 0 &&
      schemaTablesResp.tables.every((t) => t.schemaName === 'e2e_schema'),
  );

  // backend: 制限スキーマ外での管理テーブル登録は拒否される
  const rejectResp = await page.evaluate(async (connId) => {
    const res = await fetch('/api/v1/managed-tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connectionId: connId, schemaName: 'dbo', tableName: 'bigdata', displayName: 'e2e-reject-test', slug: 'e2e-reject-test',
      }),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, restrictedConn.id);
  check(
    'backend rejects managed-table registration outside the restricted schema',
    rejectResp.status === 400 && !!rejectResp.body?.message?.includes('e2e_schema'),
  );

  // 後始末: テスト用接続を削除
  await page.evaluate(async (id) => {
    await fetch(`/api/v1/connections/${id}`, { method: 'DELETE' });
  }, restrictedConn.id);

  // 8.12) home-config API(S48-1): admin は保存/削除でき,検証が効く
  const hcPut = (body) => page.evaluate(async (b) => {
    const res = await fetch('/api/v1/home-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(b),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, body);
  const hcSample = JSON.stringify({
    version: 1,
    widgets: [
      { type: 'hero', size: 3, title: 'E2Eポータル', subtitle: 'ヒーロー副題',
        links: [{ label: '外部リンク', url: 'https://example.com', icon: 'language' }] },
      { type: 'note', size: 2, tone: 'warn', text: 'E2Eメンテ告知' },
      { type: 'rows', size: 1, title: 'リンク集',
        items: [{ label: 'テーブル管理', url: '/tables', icon: 'table_view' }] },
      { type: 'heading', size: 3, text: '権限で隠れる見出し', requires: 'no-such-action' },
    ],
  });
  const hcSaved = await hcPut({ config: hcSample });
  check(
    'home-config: admin can save (returns config + updatedBy)',
    hcSaved.status === 200 && hcSaved.body?.config === hcSample &&
      hcSaved.body?.updatedBy === 'local',
  );

  // レンダラ: 保存した構成が /home に描画され,requires は権限フィルタされる
  await page.goto(BASE + '/home', { waitUntil: 'networkidle2' });
  await sleep(800);
  const homeText = await bodyText(page);
  check(
    'home renders configured widgets (hero/note/rows)',
    homeText.includes('E2Eポータル') && homeText.includes('E2Eメンテ告知') &&
      homeText.includes('テーブル管理'),
  );
  check(
    'home hides widgets whose requires is not granted',
    !homeText.includes('権限で隠れる見出し'),
  );
  check(
    'external link shows open_in_new marker',
    await page.evaluate(() =>
      [...document.querySelectorAll('tm-home-page .hero-link .ext')].length === 1),
  );

  const hcBad = await hcPut({ config: '{broken' });
  check('home-config: broken JSON rejected (400)', hcBad.status === 400);
  const hcCleared = await hcPut({ config: null });
  check(
    'home-config: null clears back to default',
    hcCleared.status === 200 && hcCleared.body?.config === null,
  );

  // 未設定に戻すと組込の既定表示(機能カード)へフォールバックする
  await page.goto(BASE + '/home', { waitUntil: 'networkidle2' });
  await sleep(800);
  check(
    'home falls back to granted-function cards after reset',
    await page.evaluate(() =>
      document.querySelectorAll('tm-home-container .entry').length >= 3),
  );

  // 8.13) ホーム設定ビルダー(S48-3)
  await page.goto(BASE + '/settings', { waitUntil: 'networkidle2' });
  await sleep(500);
  check(
    'settings menu has home-builder card',
    (await bodyText(page)).includes('ホーム設定'),
  );
  await page.evaluate(() => {
    [...document.querySelectorAll('.card')]
      .find((c) => c.textContent?.includes('ホーム設定'))?.click();
  });
  await sleep(800);
  check('home-builder route opens', page.url().includes('/settings/home'));
  // 未設定でも空キャンバスではなく「現在の表示」= 組込既定(機能カード)を実体化して見せる
  check(
    'builder materializes built-in default on canvas',
    await page.evaluate(() =>
      document.querySelectorAll('.canvas .cell').length === 1 &&
      [...document.querySelectorAll('.canvas tm-home-widget .entry .name')]
        .some((n) => n.textContent?.includes('テーブル管理'))),
  );
  check(
    'materialized default is not dirty',
    await page.evaluate(() => document.querySelector('.dirty') === null),
  );

  // プレビュー: 実レンダラ(tm-home-page)で実際の表示を確認できる
  await clickByText(page, 'button', 'プレビュー');
  await sleep(300);
  check(
    'preview shows the real renderer without editor chrome',
    await page.evaluate(() =>
      document.querySelector('.preview-area tm-home-page') !== null &&
      document.querySelector('.canvas') === null &&
      document.querySelector('tm-home-builder .toolbar') === null &&
      document.querySelector('tm-home-builder .back-to-edit') !== null),
  );
  await clickByText(page, 'button', '編集に戻る');
  await sleep(300);
  check(
    'back to edit restores the canvas',
    await page.evaluate(() => document.querySelector('.canvas') !== null),
  );

  // パレットから見出しを追加 → インスペクタで文言を編集 → プレビュー反映
  await page.evaluate(() => {
    [...document.querySelectorAll('.palette-item')]
      .find((b) => b.textContent?.includes('見出し'))?.click();
  });
  await sleep(300);
  await page.evaluate(() => {
    const el = document.querySelector('.inspector input.in');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, 'E2E見出し');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(300);
  check(
    'builder preview shows edited heading',
    await page.evaluate(() =>
      [...document.querySelectorAll('.canvas tm-home-widget .heading')]
        .some((h) => h.textContent?.includes('E2E見出し'))),
  );
  check(
    'builder shows dirty badge',
    await page.evaluate(() => document.querySelector('.dirty') !== null),
  );

  // 保存(=即公開)。確認ダイアログを経て API に反映される
  await page.click('.save-btn');
  await sleep(300);
  await page.evaluate(() => {
    [...document.querySelectorAll('tm-confirm-dialog button')]
      .find((b) => b.textContent?.includes('保存して公開'))?.click();
  });
  await sleep(600);
  const savedCfg = await page.evaluate(async () => {
    const res = await fetch('/api/v1/home-config');
    return (await res.json()).config;
  });
  check(
    'builder save publishes config',
    typeof savedCfg === 'string' && savedCfg.includes('E2E見出し'),
  );
  await page.goto(BASE + '/home', { waitUntil: 'networkidle2' });
  await sleep(600);
  check('published config renders on /home', (await bodyText(page)).includes('E2E見出し'));

  // JSON パネルに現在の構成が出る(2環境間の持ち運び用)
  await page.goto(BASE + '/settings/home', { waitUntil: 'networkidle2' });
  await sleep(800);
  await clickByText(page, 'button', 'JSON');
  await sleep(200);
  check(
    'JSON panel shows current layout',
    await page.evaluate(() =>
      document.querySelector('.json-text')?.value.includes('E2E見出し') ?? false),
  );
  await clickByText(page, 'button', 'JSON'); // 閉じる

  // 未保存の変更 → サイドバーで離脱 → pendingChangesGuard の確認 → 破棄
  await page.evaluate(() => {
    [...document.querySelectorAll('.palette-item')]
      .find((b) => b.textContent?.includes('テキスト'))?.click();
  });
  await sleep(300);
  await page.evaluate(() => {
    [...document.querySelectorAll('.menu-item')]
      .find((b) => b.textContent?.includes('ホーム'))?.click();
  });
  await sleep(400);
  check(
    'leaving dirty builder asks for confirmation',
    await page.evaluate(() => document.querySelector('tm-confirm-dialog') !== null),
  );
  await page.evaluate(() => {
    [...document.querySelectorAll('tm-confirm-dialog button')]
      .find((b) => b.textContent?.includes('破棄して移動'))?.click();
  });
  await sleep(600);
  check('discard-and-leave navigates away', page.url().endsWith('/home'));

  // 破棄した変更は残らない(保存済みの2ウィジェット = 既定カード+見出し)
  await page.goto(BASE + '/settings/home', { waitUntil: 'networkidle2' });
  await sleep(800);
  check(
    'discarded change is not persisted',
    await page.evaluate(() => document.querySelectorAll('.canvas .cell').length === 2),
  );

  // 既定に戻す(config 削除)→ API は null,キャンバスは組込既定の実体化に戻る
  await clickByText(page, 'button', '既定に戻す');
  await sleep(300);
  await page.evaluate(() => {
    [...document.querySelectorAll('tm-confirm-dialog button')]
      .find((b) => b.textContent?.includes('既定に戻す'))?.click();
  });
  await sleep(600);
  const resetCfg = await page.evaluate(async () => {
    const res = await fetch('/api/v1/home-config');
    return (await res.json()).config;
  });
  check(
    'builder reset clears config back to null',
    resetCfg === null &&
      await page.evaluate(() =>
        document.querySelectorAll('.canvas .cell').length === 1 &&
        document.querySelector('.dirty') === null),
  );

  // 9) sato(user): サイドバーに履歴/設定なし,/history は弾かれる
  await logout(page);
  await login(page, 'sato', 'Fidev01!');
  const satoMenu = await page.evaluate(() =>
    [...document.querySelectorAll('.menu-item')].map((b) => b.textContent?.trim() ?? ''),
  );
  check(
    'sato sidebar hides history/settings',
    !satoMenu.some((m) => m.includes('操作履歴') || m.includes('設定')),
  );
  await page.goto(BASE + '/history', { waitUntil: 'networkidle2' });
  await sleep(600);
  check('sato /history redirected', !page.url().includes('/history'));

  // home-config は読み取りは全員可,変更は settings:admin のみ
  const satoHc = await page.evaluate(async () => {
    const get = await fetch('/api/v1/home-config');
    const put = await fetch('/api/v1/home-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: '{}' }),
    });
    return { get: get.status, put: put.status };
  });
  check('home-config: user can read but not write', satoHc.get === 200 && satoHc.put === 403);
} catch (e) {
  console.log('E2E ERROR:', e.message);
  results.push(['FAIL', 'uncaught: ' + e.message]);
  try {
    await page.screenshot({ path: 'e2e-failure.png' });
    console.log('screenshot saved: e2e-failure.png');
  } catch { /* ignore */ }
} finally {
  await browser.close().catch(() => undefined);
}

const fails = results.filter(([s]) => s === 'FAIL').length;
console.log(`\n=== ${results.length - fails}/${results.length} passed ===`);
process.exit(fails > 0 ? 1 : 0);
