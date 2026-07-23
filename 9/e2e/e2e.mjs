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

// mat-select はオーバーレイ描画のため，トリガーをクリックして option を文言で選ぶ
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

// 削除/非表示(×)は画面編集モード中のみ表示されるため，カードの
// 削除/非表示をテストする前後でこれらを使って明示的に出入りする。
async function enterDashboardEditMode(page) {
  await page.click('button.fab');
  await sleep(300);
  await clickByText(page, 'tm-add-feature-dialog button.entry', 'テンプレート');
  await sleep(300);
  await clickByText(page, 'tm-add-feature-dialog button.entry', '画面編集');
  await sleep(300);
}
async function exitDashboardEditMode(page) {
  await clickByText(page, '.edit-actions button', '戻る');
  await sleep(300);
}

async function login(page, user, pass) {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(400);
  await page.evaluate(() => {
    // 前ユーザーの列幅などは残して良いが，テストを決定的にするためクリア
  });
  await page.type('input[type="text"]', user);
  await page.type('input[type="password"]', pass);
  await clickByText(page, 'button', 'ログイン');
  await page.waitForFunction(() => location.pathname === '/dashboard', { timeout: 10000 });
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

const browser = await puppeteer.connect({
  browserURL: 'http://127.0.0.1:9223',
  defaultViewport: { width: 1400, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

try {
  // 0) 言語プルダウン(ログイン画面): en に切替で文言が変わり，ja に戻す
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

  // 1) local(admin) ログイン → サイドバー構成と FAB
  await page.type('input[type="text"]', 'local');
  await page.type('input[type="password"]', 'Fidev01!');
  await clickByText(page, 'button', 'ログイン');
  await page.waitForFunction(() => location.pathname === '/dashboard', { timeout: 10000 });
  await sleep(600);

  // 状態をリセット(前回実行や手動検証の残骸を排除)。
  // 2026-07-23 改定: 項目0件は空のまま表示(既定表示へのフォールバック無し)。
  await page.evaluate(async () => {
    await fetch('/api/v1/me/dash-items', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [] }),
    });
  });
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(600);

  let text = await bodyText(page);
  check('sidebar has history + settings', /操作履歴/.test(text) && /設定/.test(text));
  check(
    'empty items shows empty dashboard (no fallback)',
    await page.evaluate(() => document.querySelectorAll('.card').length === 0),
  );
  check('empty dashboard shows add guidance', /表示するカードがありません/.test(text));

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
  await page.click('.header-title');
  await page.waitForFunction(() => location.pathname === '/dashboard', { timeout: 10000 });
  check('header title returns to dashboard', true);
  await page.goto(BASE + '/history', { waitUntil: 'networkidle2' });
  await sleep(400);
  await page.click('tm-user-menu .user-btn');
  await sleep(200);
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('tm-user-menu .drawer button')];
    btns.find((b) => b.textContent?.includes('トップへ戻る'))?.click();
  });
  await page.waitForFunction(() => location.pathname === '/dashboard', { timeout: 10000 });
  check('drawer back-to-top returns to dashboard', true);
  await sleep(500);

  // 2) FAB → 機能選択モーダル: 外クリックで閉じない / Esc で閉じる
  await page.click('button.fab');
  await sleep(300);
  check('add-feature dialog opens (機能の選択)', (await bodyText(page)).includes('機能の選択'));
  await page.mouse.click(60, 400); // 画面外(バックドロップ)
  await sleep(300);
  check('outside click does not close', (await bodyText(page)).includes('機能の選択'));
  await page.keyboard.press('Escape');
  await sleep(300);
  check('Esc closes add-feature dialog', !(await bodyText(page)).includes('機能の選択'));

  // 3) テンプレート選択 → seizo-std → テンプレのリンクカード出現
  await page.click('button.fab');
  await sleep(300);
  await clickByText(page, 'tm-add-feature-dialog button.entry', 'テンプレート');
  await sleep(300);
  await clickByText(page, 'tm-add-feature-dialog button.entry', 'テンプレートを選択');
  await sleep(400);
  text = await bodyText(page);
  check('template select lists default + seizo-std', /既定/.test(text) && /seizo-std/.test(text));
  // テンプレート一覧は同一ダイアログ内のビュー(← で戻れる)
  check('template view has back button', (await page.$('tm-add-feature-dialog .back')) !== null);
  await clickByText(page, 'tm-add-feature-dialog button.entry', 'seizo-std');
  await page.waitForFunction(
    () => [...document.querySelectorAll('.card .card-name')].some((e) => e.textContent?.includes('Wiki')),
    { timeout: 10000 },
  );
  check('template cards applied (Wiki appears)', true);

  // 4) 画面編集: FAB→[画面編集]でモード開始 → D&D はドロップごとに即保存，
  // [戻る]でモード終了(2026-07-23 決定。確定/キャンセルボタンは廃止)。
  // 並び替えと同時に削除もできる(編集モード中のみ削除ボタン表示)
  // 通常モードでは draggable=false(D&D 不可)
  const draggableOff = await page.evaluate(
    () => document.querySelector('.card')?.getAttribute('draggable'),
  );
  check('cards not draggable outside edit mode', draggableOff === 'false');

  const dragLastToFirst = () =>
    page.evaluate(() => {
      const cards = [...document.querySelectorAll('.card')];
      const src = cards[cards.length - 1]; // 末尾を先頭へ
      const dst = cards[0];
      const dt = new DataTransfer();
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt, cancelable: true }));
      dst.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt, cancelable: true }));
      src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    });
  // 4a) 画面編集モード開始: [戻る]のみ表示。削除ボタンが出る
  await page.click('button.fab');
  await sleep(300);
  await clickByText(page, 'tm-add-feature-dialog button.entry', 'テンプレート');
  await sleep(300);
  await clickByText(page, 'tm-add-feature-dialog button.entry', '画面編集');
  await sleep(300);
  check('edit mode shows back button only', await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.edit-actions button')];
    return btns.length === 1 && (btns[0].textContent ?? '').includes('戻る');
  }));
  // 画面編集モード中も削除ボタン(link-ops)が描画され，ドラッグに巻き込まれないよう
  // draggable=false が付いていること
  const editModeDeleteBtn = await page.evaluate(() => {
    const card = document.querySelector('.card');
    const btn = card?.querySelector('.link-ops button');
    return { exists: !!btn, draggable: btn?.getAttribute('draggable') };
  });
  check(
    'edit mode still shows delete button on cards',
    editModeDeleteBtn.exists && editModeDeleteBtn.draggable === 'false',
  );

  // 4b) D&D: ドロップごとに即保存され，リロードでも維持される
  // (全置換保存(PUT)で item id(=カードキー)は毎回振り直されるため，
  //  永続化の検証はキーではなくカード名の並びで行う)
  const cardNames = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.card .card-name')].map((e) => e.textContent?.trim() ?? ''),
    );
  const namesBefore = await cardNames();
  await dragLastToFirst();
  await sleep(800); // ドロップ → PUT /me/dash-items
  const namesAfterDrop = await cardNames();
  check(
    'drop moves last card to front',
    namesAfterDrop[0] === namesBefore[namesBefore.length - 1] &&
      namesAfterDrop.length === namesBefore.length,
  );
  await clickByText(page, '.edit-actions button', '戻る');
  await sleep(300);
  check('back leaves edit mode (FAB back)', (await page.$('button.fab')) !== null);
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(800);
  check('card order persists after reload (auto-saved on drop)',
    JSON.stringify(await cardNames()) === JSON.stringify(namesAfterDrop));

  // 5) bigdata: 件数カップ / 列フィルタ Enter / まとめて削除
  await page.goto(BASE + '/table-maint', { waitUntil: 'networkidle2' });
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

  // 列幅: 全実列は内容幅で固定，末尾の疑似カラム(フィラー)が余白を
  // 吸収して右端まで届く。実列とフィラーの間には区切り線が出る。
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
      // 実列の最終(val)とフィラーの間に区切り線(border-right)がある
      divider: getComputedStyle(lastReal).borderRightWidth !== '0px',
      fillerTds: document.querySelectorAll('tbody td[data-tm-filler]').length > 0,
      // フィラーは隣セルの clone なのでヘッダー色・sticky が実列と一致する
      bgMatch:
        getComputedStyle(filler).backgroundColor === getComputedStyle(lastReal).backgroundColor,
      sticky: getComputedStyle(filler).position === 'sticky',
    };
  });
  check(
    'filler pseudo-column absorbs remaining width (with divider)',
    lastColFill.fillerExists &&
      lastColFill.noHScroll &&
      lastColFill.fillerFillsRight &&
      lastColFill.firstNarrow &&
      lastColFill.divider &&
      lastColFill.fillerTds,
  );
  check(
    'filler header styled like real headers (bg + sticky)',
    lastColFill.bgMatch && lastColFill.sticky,
  );

  // 単独リサイズ: ドラッグした列だけが変わり，他列とテーブル全幅は不変
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

  // 複数選択モード: トグル中だけチェックボックスが出る
  check('checkboxes hidden by default', (await page.$('.check-td')) === null);
  await page.click('.multi-toggle');
  await sleep(200);
  check('multi-select shows checkboxes', (await page.$$('.check-td')).length === 50);
  await page.click('.multi-toggle');
  await sleep(200);
  check('toggling off hides checkboxes', (await page.$('.check-td')) === null);

  // 列フィルタ: 既定では非表示 → じょうごトグルで開く
  check('filter row hidden by default', (await page.$('.filter-row')) === null);
  await page.click('.filter-toggle');
  await sleep(200);
  check('filter toggle shows filter row', (await page.$('.filter-row')) !== null);

  // 2列目 = code で絞込
  await setAndEnter(page, 'input.filter-input', 1, 'B-0012');
  await page.waitForFunction(() => document.body.innerText.includes('10件'), { timeout: 10000 });
  // チェックボックス列の有無に依存しないよう .check-td を除いて 2 列目(code)を取る
  const firstCode = await page.evaluate(
    () => document.querySelector('tbody tr')?.querySelectorAll('td:not(.check-td)')[1]?.textContent?.trim(),
  );
  check('column filter (code like B-0012 -> 10 rows)', firstCode === 'B-00120');

  // 適用中チップ: フィルタ行を閉じても残り，× で解除できる
  const chipText = await page.evaluate(() => document.querySelector('.chip')?.textContent?.trim());
  check('active filter shows chip', chipText?.includes('code') && chipText?.includes('B-0012'));
  await page.click('.filter-toggle'); // 行を閉じる
  await sleep(200);
  check('chip survives closing filter row', (await page.$('.chip')) !== null);
  await page.click('.chip-x');
  await page.waitForFunction((re) => new RegExp(re).test(document.body.innerText), { timeout: 10000 }, FULL_COUNT.source);
  check('chip remove restores full count', (await page.$('.chip')) === null);

  // sticky ヘッダー: テーブル内部スクロールでもヘッダーが見えている
  const sticky = await page.evaluate(() => {
    const wrap = document.querySelector('.table-wrap');
    wrap.scrollTop = 500;
    const th = document.querySelector('thead th');
    return Math.abs(th.getBoundingClientRect().top - wrap.getBoundingClientRect().top) < 2;
  });
  check('table header is sticky while scrolling', sticky);

  // 5b) まとめて削除: 行チェック → ボタン出現 → confirm(キャンセル/OK)
  // 実行ごとに一意な code を使う(失敗時の残骸が他の実行に混ざらないように)。
  // id は IDENTITY(readonly)のため insert に含めない。
  const uniq = `E2E${Date.now() % 1000000}`;
  const insertStatus = await page.evaluate(async (uniq) => {
    const id = Number(location.pathname.split('/').pop());
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

  await page.click('.filter-toggle');
  await sleep(200);
  await setAndEnter(page, 'input.filter-input', 1, uniq);
  await page.waitForFunction(
    (uniq) => document.querySelectorAll('tbody tr').length === 2 && document.body.innerText.includes(uniq),
    { timeout: 10000 },
    uniq,
  );
  check('bulk delete button hidden without selection', (await page.$('.bulk-delete')) === null);

  await page.click('.multi-toggle'); // 複数選択モードへ
  await sleep(200);
  await page.click('.check-th input'); // 全選択
  await sleep(200);
  const bulkLabel = await page.evaluate(() => document.querySelector('.bulk-delete')?.textContent?.trim());
  check('bulk delete button appears with count', bulkLabel?.includes('まとめて削除') && bulkLabel?.includes('2'));

  // 動的ボタンは固定ボタン群(フィルタ)の左側に出る(既存ボタンがずれない)
  check(
    'dynamic buttons appear left of filter toggle',
    await page.evaluate(() => {
      const bulk = document.querySelector('.bulk-delete');
      const filter = document.querySelector('.filter-toggle');
      return !!bulk && !!filter &&
        !!(bulk.compareDocumentPosition(filter) & Node.DOCUMENT_POSITION_FOLLOWING);
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
  check('bulk cancel keeps rows', (await page.$$('tbody tr .check-td')).length === 2);
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
  await page.click('.chip-x'); // フィルタ解除して後続テストへ
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

  // 全件出力(列フィルタ適用 + Excel互換 = BOM 付き)。フィルタ行は開いていなければ開く
  if ((await page.$('.filter-row')) === null) {
    await page.click('.filter-toggle');
    await sleep(200);
  }
  await setAndEnter(page, 'input.filter-input', 1, 'B-0012');
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
  await page.click('.chip-x');
  await page.waitForFunction((re) => new RegExp(re).test(document.body.innerText), { timeout: 10000 }, FULL_COUNT.source);

  // 選択範囲出力(2 行チェック，Excel互換 OFF に戻す)
  await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.check-td input')];
    boxes[0].click();
    boxes[1].click();
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
    [...document.querySelectorAll('.check-td input:checked')].forEach((b) => b.click());
  });
  const rowCenter = (idx) =>
    page.evaluate((idx) => {
      const r = document.querySelectorAll('tbody tr')[idx].getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, idx);
  // チェックボックス列の上からドラッグ開始できることも同時に検証する
  const checkCellCenter = (idx) =>
    page.evaluate((idx) => {
      const r = document.querySelectorAll('tbody tr')[idx].querySelector('.check-td').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, idx);
  const pA = await checkCellCenter(0);
  const pB = await rowCenter(4);
  await page.mouse.move(pA.x, pA.y);
  await page.mouse.down();
  await page.mouse.move(pB.x, pB.y, { steps: 8 });
  await page.mouse.up();
  await sleep(300);
  check('drag range selects 5 rows (from checkbox column)', (await page.$$('.check-td input:checked')).length === 5);
  check('drag does not open edit dialog', (await page.$('tm-row-edit-dialog')) === null);

  // 複数選択モード中は行クリック = 選択トグル(編集ダイアログは開かない)
  await page.evaluate(() => {
    [...document.querySelectorAll('.check-td input:checked')].forEach((b) => b.click());
  });
  const p3 = await rowCenter(2);
  await page.mouse.click(p3.x, p3.y);
  await sleep(200);
  check(
    'row click toggles selection in multi mode',
    (await page.$$('.check-td input:checked')).length === 1 &&
      (await page.$('tm-row-edit-dialog')) === null,
  );
  await page.mouse.click(p3.x, p3.y);
  await sleep(200);
  check('row click again deselects', (await page.$$('.check-td input:checked')).length === 0);
  await page.click('.multi-toggle'); // モード解除(選択破棄)
  await sleep(200);
  if ((await page.$('.filter-row')) !== null) {
    await page.click('.filter-toggle'); // フィルタ行を閉じる
    await sleep(200);
  }

  // ============================= CSV 取込 =============================
  await page.goto(BASE + '/table-maint', { waitUntil: 'networkidle2' });
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
    const id = Number(location.pathname.split('/').pop());
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
  await page.click('.check-th input');
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

  // 重複を残して保存 → 409(取込 N 行目)で全ロールバック，(*)行は残る
  await injectCsv('code,name,val\r\nC-001,重複,99\r\n');
  await sleep(500);
  await clickByText(page, 'tm-csv-merge-dialog button', '適応');
  await sleep(300);
  await page.click('.check-th input');
  await sleep(200);
  await page.click('.save-pending');
  await sleep(800);
  const dupErr = await page.evaluate(() => document.querySelector('p.error')?.textContent ?? '');
  check('duplicate save rejected with row number', dupErr.includes('重複') && dupErr.includes('取込 1 行目'));
  check('pending row kept after rollback', (await page.$$('tbody tr.pending')).length === 1);

  // (*)行のまとめて削除 = ローカル破棄(API を呼ばない)
  await page.evaluate(() => {
    [...document.querySelectorAll('.check-td input:checked')].forEach((b) => b.click());
    document.querySelectorAll('.check-td input')[0].click();
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
    const id = Number(location.pathname.split('/').pop());
    const res = await fetch(`/api/v1/managed-tables/${id}/rows/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deletes: [{ key: { code: `${u}-1` } }, { key: { code: `${u}-3` } }] }),
    });
    return res.status;
  }, csvUniq);
  check('cleanup imported rows', cleanupStatus === 200);

  // ============== 多列テーブル(20列)の横スクロール ==============
  await page.goto(BASE + '/table-maint', { waitUntil: 'networkidle2' });
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
  // 履歴のフィルタ形式(じょうご + フィルタ行 + チップ。kind 型は select)
  check('history filter row hidden by default', (await page.$('.filter-row')) === null);
  await page.click('.filter-toggle');
  await sleep(200);
  await page.evaluate(() => {
    const sel = [...document.querySelectorAll('.filter-row select')][1]; // 結果
    sel.value = 'failure';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(
    () => {
      const b = [...document.querySelectorAll('tbody .badge')];
      return b.length > 0 && b.every((x) => x.textContent.trim() === 'failure');
    },
    { timeout: 10000 },
  );
  check('history result filter (select) works', true);
  check('history filter chip shown', (await page.$('.chip')) !== null);
  await page.click('.chip-x');
  await sleep(500);
  check('history chip remove clears filter', (await page.$('.chip')) === null);

  // 履歴の CSV 出力(2026-07-24: テーブルメンテと同じ3スコープのダイアログに)
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
  // detail は画面表示用に整形済み(改行入り)の JSON だが，全件出力(サーバー
  // 生成，json.Marshal によるコンパクト1行)と体裁を揃えるためコンパクトに
  // 詰め直している(2026-07-24 修正: 詰め直し忘れで改行入りのまま出力され，
  // 1レコードが複数行に見えていた不具合)。よってレコード行数 = 表示行数。
  const pageRowCount = await page.evaluate(() => document.querySelectorAll('tbody tr.row').length);
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

  // 複数選択: チェックボックストグル(2行)とドラッグ範囲選択の両方を検証
  await page.click('.multi-toggle');
  await sleep(200);
  check('history multi-select shows checkboxes', (await page.$$('.check-td')).length > 0);

  const histRowCenter = (i) =>
    page.evaluate((i) => {
      const r = document.querySelectorAll('tbody tr.row')[i].getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, i);
  const hA = await histRowCenter(0);
  const hB = await histRowCenter(3);
  await page.mouse.move(hA.x, hA.y);
  await page.mouse.down();
  await page.mouse.move(hB.x, hB.y, { steps: 8 });
  await page.mouse.up();
  await sleep(300);
  check('history drag range selects 4 rows', (await page.$$('.check-td input:checked')).length === 4);
  check('history drag does not expand detail row', (await page.$('.detail-row')) === null);

  // チェック解除してから2行だけチェックし，選択範囲出力を検証
  await page.evaluate(() => {
    [...document.querySelectorAll('.check-td input:checked')].forEach((b) => b.click());
  });
  await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.check-td input')];
    boxes[0].click();
    boxes[1].click();
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
  check('history multi-select turned off (checkbox column gone)', (await page.$('.check-td')) === null);

  // 操作(部分一致・Enter 適用)
  await page.evaluate(() => {
    const el = document.querySelectorAll('.filter-row input[type="search"]')[1]; // operation
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, 'rows.export');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await page.waitForFunction(
    () => {
      const ops = [...document.querySelectorAll('tbody tr.row td:nth-child(4)')];
      return ops.length > 0 && ops.every((td) => td.textContent.includes('rows.export'));
    },
    { timeout: 10000 },
  );
  check('history operation filter (LIKE) works', true);

  // 日付範囲(開始日)は change で即適用されチップが出る
  await page.evaluate(() => {
    const el = document.querySelectorAll('.filter-row input[type="date"]')[0];
    el.value = '2026-07-10';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(600);
  check('history date-from chip appears', (await bodyText(page)).includes('開始日'));

  // [すべて解除]
  await page.evaluate(() => document.querySelector('.chips-clear')?.click());
  await sleep(600);
  check('history clear-all removes chips', (await page.$('.chip')) === null);

  await page.click('.filter-toggle'); // 行を閉じて列幅テストへ
  await sleep(200);

  const colWidths = await page.evaluate(() =>
    [...document.querySelectorAll('colgroup col')].map((c) => c.style.width),
  );
  check('column width reapplied after reload', colWidths.some((w) => w !== ''));

  // 7) 設定 > 機能マスタ: settings 行はロック(チェックボックス無し) + API 409
  await page.goto(BASE + '/settings/dashboard', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.body.innerText.includes('table-maint'), { timeout: 10000 });
  const settingsRow = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('tbody tr')];
    const row = rows.find((r) => r.textContent?.includes('settings'));
    return {
      hasCheckbox: row?.querySelector('input[type="checkbox"]') !== null,
      hasLock: [...(row?.querySelectorAll('mat-icon') ?? [])].some((i) => i.textContent?.trim() === 'lock'),
    };
  });
  check('settings row has no enabled checkbox', settingsRow.hasCheckbox === false);
  check('settings row shows lock icon', settingsRow.hasLock === true);

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

  // 8) テンプレート管理: 作成 → 一覧反映 → 削除
  await clickByText(page, '.mat-mdc-tab-link', 'テンプレート');
  await sleep(400);
  await clickByText(page, 'button', 'テンプレートを作成');
  await sleep(400);
  check('template editor opens', (await bodyText(page)).includes('テンプレートの作成'));
  await page.evaluate(() => {
    const dlg = document.querySelector('tm-template-editor-dialog');
    const input = dlg.querySelectorAll('input[type="text"]')[0];
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'e2e-tpl');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // 機能を1つ追加(セレクトの先頭候補)
  await page.evaluate(() => {
    const dlg = document.querySelector('tm-template-editor-dialog');
    const sel = dlg.querySelector('select');
    const opt = [...sel.options].find((o) => o.value !== '');
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const btns = [...dlg.querySelectorAll('.adder .btn')];
    btns[0].click();
  });
  await sleep(200);
  await clickByText(page, 'tm-template-editor-dialog button', '保存');
  await page.waitForFunction(
    () => document.body.innerText.includes('e2e-tpl') && !document.querySelector('tm-template-editor-dialog .dialog'),
    { timeout: 10000 },
  );
  check('template create works', true);
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('tbody tr')];
    const row = rows.find((r) => r.textContent?.includes('e2e-tpl'));
    row?.querySelector('.icon-btn.danger, button.danger')?.click();
  });
  await sleep(400);
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('tm-confirm-dialog button')];
    btns.find((b) => b.textContent?.trim() === '実行')?.click();
  });
  await page.waitForFunction(() => !document.body.innerText.includes('e2e-tpl'), { timeout: 10000 });
  check('template delete works', true);

  // 8.6) サイドバー「テーブルメンテ」/ テーブルカード / 列モード / 前後値
  // 列モードの検証は demo.dbo.audit_demo(id=6, phone=除外, updated_at=編集不可)
  // を登録済みであることに依存する。
  await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle2' });
  await sleep(600);
  const sideMenu = await page.evaluate(() =>
    [...document.querySelectorAll('.menu-item')].map((b) => b.textContent?.trim() ?? ''),
  );
  check('sidebar has table-maint item', sideMenu.some((m) => m.includes('テーブルメンテ')));
  await clickByText(page, '.menu-item', 'テーブルメンテ');
  await page.waitForFunction(() => location.pathname === '/table-maint', { timeout: 10000 });
  check('sidebar table-maint navigates to select page', true);

  // テーブルカード: (+) → 機能へのショートカット追加 → テーブルメンテ →
  // テーブルを指定 → 商品マスタ → カード出現 → 遷移 → 削除
  await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle2' });
  await sleep(600);
  await page.click('button.fab');
  await sleep(300);
  await clickByText(page, 'tm-add-feature-dialog button.entry', '機能リンク');
  await sleep(400);
  await clickByText(page, 'tm-add-feature-dialog button.entry', 'テーブルメンテナンス');
  await sleep(400);
  // ← で1つ戻り，また進める(戻る動線の検証)
  await page.click('tm-add-feature-dialog .back');
  await sleep(300);
  check(
    'back button returns to function list',
    (await bodyText(page)).includes('テーブルメンテナンス') && !(await bodyText(page)).includes('テーブルを指定'),
  );
  await clickByText(page, 'tm-add-feature-dialog button.entry', 'テーブルメンテナンス');
  await sleep(400);
  await clickByText(page, 'tm-add-feature-dialog button.entry', 'テーブルを指定');
  await sleep(500);
  check('table pick view lists tables', (await bodyText(page)).includes('商品マスタ'));
  await clickByText(page, 'tm-add-feature-dialog button.entry', '商品マスタ');
  await sleep(900);
  const findTableCard = () =>
    page.evaluate(
      () =>
        [...document.querySelectorAll('.card')].some((x) =>
          x.textContent?.includes('商品マスタ'),
        ),
    );
  check('table card appears', await findTableCard());
  // カード粒度統一 — 1行目=機能名 / 2行目(詳細)=テーブル名
  const tableCardShape = await page.evaluate(() => {
    const c = [...document.querySelectorAll('.card')].find((x) =>
      x.textContent?.includes('商品マスタ'),
    );
    return c
      ? {
          name: c.querySelector('.card-name')?.textContent?.trim(),
          detail: c.querySelector('.card-detail')?.textContent?.trim(),
        }
      : null;
  });
  check(
    'table card shows function name + table detail',
    !!tableCardShape &&
      tableCardShape.name === 'テーブルメンテナンス' &&
      tableCardShape.detail === '商品マスタ',
  );
  await page.evaluate(() => {
    const c = [...document.querySelectorAll('.card')].find((x) =>
      x.textContent?.includes('商品マスタ'),
    );
    c?.querySelector('.card-body')?.click();
  });
  await page.waitForFunction(() => location.pathname === '/table-maint/1', { timeout: 10000 });
  check('table card navigates straight to the table', true);
  await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle2' });
  await sleep(600);
  await enterDashboardEditMode(page);
  await page.evaluate(() => {
    const c = [...document.querySelectorAll('.card')].find((x) =>
      x.textContent?.includes('商品マスタ'),
    );
    c?.querySelector('.link-ops .danger')?.click();
  });
  await sleep(400);
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('tm-confirm-dialog button')];
    btns.find((b) => b.textContent?.trim() === '実行')?.click();
  });
  await sleep(800);
  check('table card removed', !(await findTableCard()));

  // 列モード: 監査デモ(id=6)のグリッドに phone が無く updated_at はある
  await page.goto(BASE + '/table-maint/6', { waitUntil: 'networkidle2' });
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

  // 8.7) 機能ショートカットカード / カード削除(実体化コピー方式) / 新規グレーアウト
  await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle2' });
  await sleep(600);
  await page.click('button.fab');
  await sleep(300);
  await clickByText(page, 'tm-add-feature-dialog button.entry', '機能リンク');
  await sleep(400);
  await clickByText(page, 'tm-add-feature-dialog button.entry', 'テーブルメンテナンス');
  await sleep(400);
  await clickByText(page, 'tm-add-feature-dialog button.entry', 'テーブルメンテナンス画面');
  await sleep(900);
  const shortcutCardCount = () =>
    page.evaluate(
      () =>
        [...document.querySelectorAll('.card')].filter((x) =>
          x.textContent?.includes('テーブルメンテナンス'),
        ).length,
    );
  const countAfterShortcut = await shortcutCardCount();
  check('function shortcut card appears', countAfterShortcut > 0);
  await page.evaluate(() => {
    const c = [...document.querySelectorAll('.card')].find((x) =>
      x.textContent?.includes('テーブルメンテナンス'),
    );
    c?.querySelector('.card-body')?.click();
  });
  await page.waitForFunction(() => location.pathname === '/table-maint', { timeout: 10000 });
  check('shortcut card navigates to function screen', true);
  await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle2' });
  await sleep(600);
  await enterDashboardEditMode(page);
  await page.evaluate(() => {
    const c = [...document.querySelectorAll('.card')].find((x) =>
      x.textContent?.includes('テーブルメンテナンス'),
    );
    c?.querySelector('.link-ops .danger')?.click();
  });
  await sleep(400);
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('tm-confirm-dialog button')];
    btns.find((b) => b.textContent?.trim() === '実行')?.click();
  });
  await sleep(800);
  check('shortcut card removed', (await shortcutCardCount()) === countAfterShortcut - 1);

  // カードの×は実削除(実体化コピー方式。2026-07-22 決定):
  // 1件減った項目列で全置換保存される。
  // (画面編集モードは継続中。× は edit モード中のみ表示される)
  const cardCountBeforeDelete = await page.evaluate(() => document.querySelectorAll('.card').length);
  const deleteTarget = await page.evaluate(() => {
    const c = document.querySelector('.card');
    if (!c) return null;
    c.querySelector('.link-ops .danger')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return c.getAttribute('data-key');
  });
  await sleep(400);
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('tm-confirm-dialog button')];
    btns.find((b) => b.textContent?.trim() === '実行')?.click();
  });
  await sleep(800);
  const itemsAfterDelete = await page.evaluate(async () => {
    const r = await fetch('/api/v1/me/dash-items').then((x) => x.json());
    return r.items;
  });
  check(
    'delete card materializes and persists (1 fewer item)',
    deleteTarget !== null && itemsAfterDelete.length === cardCountBeforeDelete - 1,
  );
  check(
    'deleted card disappears',
    await page.evaluate(
      (key) => ![...document.querySelectorAll('.card')].some((c) => c.getAttribute('data-key') === key),
      deleteTarget,
    ),
  );
  // 「既定」を選ぶ = その時点で権限のある全機能を実体化コピーする
  // (2026-07-23 改定: 0件フォールバック廃止。既定も明示的なコピー適用)
  // (通常の FAB に戻すため画面編集モードを抜ける)
  await exitDashboardEditMode(page);
  await page.click('button.fab');
  await sleep(300);
  await clickByText(page, 'tm-add-feature-dialog button.entry', 'テンプレート');
  await sleep(300);
  await clickByText(page, 'tm-add-feature-dialog button.entry', 'テンプレートを選択');
  await sleep(400);
  await clickByText(page, 'tm-add-feature-dialog button.entry', '既定');
  await sleep(900);
  const itemsAfterReset = await page.evaluate(async () => {
    const r = await fetch('/api/v1/me/dash-items').then((x) => x.json());
    return r.items;
  });
  check(
    'selecting default materializes granted functions (actions only)',
    itemsAfterReset.length > 0 && itemsAfterReset.every((it) => it.kind === 'action'),
  );
  check(
    'default copy excludes sidebar-only functions',
    !itemsAfterReset.some((it) => it.actionCode === 'settings' || it.actionCode === 'history'),
  );
  check(
    'default apply shows function cards',
    await page.evaluate(() => document.querySelectorAll('.card').length > 0),
  );

  // 最後のカードを×で消しても勝手に既定へ戻らない(今回の不具合の回帰テスト)。
  // local の既定は table-maint 1枚なので，全カードを×で消して0件を作る。
  await page.click('button.fab');
  await sleep(300);
  await clickByText(page, 'tm-add-feature-dialog button.entry', 'テンプレート');
  await sleep(300);
  await clickByText(page, 'tm-add-feature-dialog button.entry', '画面編集');
  await sleep(300);
  while (await page.evaluate(() => document.querySelectorAll('.card').length > 0)) {
    await page.evaluate(() => {
      document.querySelector('.card .link-ops .danger')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await sleep(400);
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('tm-confirm-dialog button')];
      btns.find((b) => b.textContent?.trim() === '実行')?.click();
    });
    await sleep(800);
  }
  await exitDashboardEditMode(page);
  const afterDeleteAll = await page.evaluate(async () => {
    const r = await fetch('/api/v1/me/dash-items').then((x) => x.json());
    return { items: r.items.length, cards: document.querySelectorAll('.card').length };
  });
  check(
    'deleting the last card keeps the dashboard empty (no auto-restore)',
    afterDeleteAll.items === 0 && afterDeleteAll.cards === 0,
  );
  check(
    'emptied dashboard shows add guidance',
    /表示するカードがありません/.test(await bodyText(page)),
  );
  // 以降のテストのため既定構成を適用し直す
  await page.click('button.fab');
  await sleep(300);
  await clickByText(page, 'tm-add-feature-dialog button.entry', 'テンプレート');
  await sleep(300);
  await clickByText(page, 'tm-add-feature-dialog button.entry', 'テンプレートを選択');
  await sleep(400);
  await clickByText(page, 'tm-add-feature-dialog button.entry', '既定');
  await sleep(900);

  // 新規グレーアウト: 監査デモ(6)の必須列 name を一時的に除外して確認 → 戻す
  await page.evaluate(async () => {
    await fetch('/api/v1/managed-tables/6', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hiddenColumns: ['phone', 'name'] }),
    });
  });
  await page.goto(BASE + '/table-maint/6', { waitUntil: 'networkidle2' });
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

  // 8.8) 管理テーブルの行クリック → 編集ダイアログ(表示名/説明/列モード)
  await page.goto(BASE + '/settings/table-maint', { waitUntil: 'networkidle2' });
  await sleep(600);
  await clickByText(page, '.mat-mdc-tab-link', '管理テーブル');
  await sleep(500);
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('tr.row-clickable')].find((tr) =>
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
      valMode: tr?.querySelector('select.mode-select')?.value ?? '',
    };
  });
  check(
    'table edit dialog opens with fixed target + current values',
    editDlg.title.includes('管理テーブルの編集') &&
      editDlg.targetShown &&
      editDlg.noCandidates &&
      editDlg.displayName === 'コードマスタ' &&
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

  // 8.8b) 固定値列 — 監査デモ(id=6)の updated_at を「保存時の現在時刻」へ
  // 切り替え，行更新でサーバーが自動セットすることを API 経由で検証 → 元に戻す
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
    // 後始末: name を戻し，列モードも readonly に戻す
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

  // 8.9) リンク追加は「機能リンク」配下のフォーム(← で戻れる) +
  //      組込機能名の言語切替追従(functions.<code> キー)
  await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle2' });
  await sleep(600);
  await page.click('button.fab');
  await sleep(300);
  const rootEntries = await page.evaluate(() =>
    [...document.querySelectorAll('tm-add-feature-dialog .entry .entry-name')].map(
      (e) => e.textContent?.trim() ?? '',
    ),
  );
  check(
    'root has function-links + template groups only',
    !rootEntries.some((e) => e.includes('リンク追加')) &&
      rootEntries.includes('機能リンク') &&
      rootEntries.includes('テンプレート'),
  );
  await clickByText(page, 'tm-add-feature-dialog button.entry', '機能リンク');
  await sleep(400);
  const scEntries = await page.evaluate(() =>
    [...document.querySelectorAll('tm-add-feature-dialog .entry .entry-name')].map(
      (e) => e.textContent?.trim() ?? '',
    ),
  );
  check(
    'URL link entry is the last item under function links',
    scEntries[scEntries.length - 1] === 'URLリンクを追加',
  );
  await clickByText(page, 'tm-add-feature-dialog button.entry', 'URLリンクを追加');
  await sleep(400);
  const linkForm = await page.evaluate(() => ({
    inputs: document.querySelectorAll('tm-add-feature-dialog .field .input').length,
    back: !!document.querySelector('tm-add-feature-dialog .back'),
  }));
  check('link form inside dialog with back button', linkForm.inputs === 2 && linkForm.back);
  // フォームから追加 → カード出現(詳細=URL) → 後始末で削除
  await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('tm-add-feature-dialog .field .input')];
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(inputs[0], 'e2e-link-card');
    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(inputs[1], 'https://example.com/e2e-link');
    inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
  });
  await clickByText(page, 'tm-add-feature-dialog .form-foot button', '追加');
  await sleep(900);
  const linkCard = await page.evaluate(() => {
    const c = [...document.querySelectorAll('.card')].find((x) =>
      x.textContent?.includes('e2e-link-card'),
    );
    return c
      ? { detail: c.querySelector('.card-detail')?.textContent?.trim() }
      : null;
  });
  check(
    'link submitted from dialog appears with URL detail',
    !!linkCard && linkCard.detail === 'https://example.com/e2e-link',
  );
  await page.evaluate(async () => {
    const r = await fetch('/api/v1/me/dash-items').then((x) => x.json());
    const items = r.items.filter((it) => it.name !== 'e2e-link-card');
    await fetch('/api/v1/me/dash-items', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: items.map((it) => ({
          kind: it.kind,
          actionId: it.actionId,
          managedTableId: it.managedTableId,
          name: it.name,
          url: it.url,
          icon: it.icon,
        })),
      }),
    });
  });

  // 言語切替: 組込機能のカード名が英語に追従し，リンクカード名は翻訳されない
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(700);
  await pickMatSelect(page, 'tm-lang-select mat-select', 'English');
  await sleep(600);
  const enCard = await page.evaluate(() =>
    [...document.querySelectorAll('.card .card-name')].map((e) => e.textContent?.trim() ?? ''),
  );
  check('builtin function card name follows language', enCard.includes('Table maintenance'));

  // 設定>ユーザー権限/機能タブでも組込機能名が言語切替に追従すること
  await page.goto(BASE + '/settings/users', { waitUntil: 'networkidle2' });
  await sleep(500);
  const usersHeaderText = await bodyText(page);
  check(
    'settings users tab: function names follow language (en)',
    usersHeaderText.includes('Table maintenance') &&
      usersHeaderText.includes('Audit log') &&
      !usersHeaderText.includes('テーブルメンテナンス'),
  );
  await page.goto(BASE + '/settings/dashboard', { waitUntil: 'networkidle2' });
  await sleep(500);
  await clickByText(page, '.mat-mdc-tab-link', 'Functions');
  await sleep(300);
  const actionsTabText = await bodyText(page);
  check(
    'settings functions tab: function names follow language (en)',
    actionsTabText.includes('Table maintenance') && !actionsTabText.includes('テーブルメンテナンス'),
  );

  await pickMatSelect(page, 'tm-lang-select mat-select', '日本語');
  await sleep(600);

  // 8.10) ヘッダーロゴ / 個人テンプレート(保存→バッジ→適用→削除)
  await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle2' });
  await sleep(600);

  // サイドバー開閉に連動してヘッダーは テキストのみ/アイコンのみ を切り替える
  // (両方出すと F アイコン + F-tool で F が重複するため)
  check(
    'sidebar expanded by default: header text only, no icon',
    (await page.$('.header-title .brand-logo')) === null &&
      (await bodyText(page)).includes('F-tool'),
  );
  await page.click('.sidebar-toggle');
  await sleep(300);
  check(
    'sidebar collapsed: header shows icon only',
    (await page.$('.header-title .brand-logo')) !== null,
  );
  // mat-icon はリガチャ名をテキストとして持つため，アイコンを除いた本文で判定する
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

  await page.click('button.fab');
  await sleep(300);
  await clickByText(page, 'tm-add-feature-dialog button.entry', 'テンプレート');
  await sleep(300);
  check(
    'template menu has select/save/edit-layout',
    (await bodyText(page)).includes('テンプレートを選択') &&
      (await bodyText(page)).includes('現在の構成を保存') &&
      (await bodyText(page)).includes('画面編集'),
  );
  await clickByText(page, 'tm-add-feature-dialog button.entry', '現在の構成を保存');
  await sleep(300);
  await page.evaluate(() => {
    const input = document.querySelector('tm-add-feature-dialog .field .input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'e2e-mytpl');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await clickByText(page, 'tm-add-feature-dialog .form-foot button', '保存');
  await sleep(1500);
  const savedTpl = await page.evaluate(async () => {
    const tpls = await fetch('/api/v1/dash-templates').then((x) => x.json());
    const my = tpls.templates.find((t) => t.name === 'e2e-mytpl');
    return { exists: !!my, personal: my?.personal === true };
  });
  check('save current layout creates a personal template', savedTpl.exists && savedTpl.personal);

  // 選択ビュー: 配布/個人バッジと個人の削除×
  await page.click('button.fab');
  await sleep(300);
  await clickByText(page, 'tm-add-feature-dialog button.entry', 'テンプレート');
  await sleep(300);
  await clickByText(page, 'tm-add-feature-dialog button.entry', 'テンプレートを選択');
  await sleep(400);
  const tplEntries = await page.evaluate(() =>
    [...document.querySelectorAll('tm-add-feature-dialog .entry')].map((b) => ({
      text: b.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      del: !!b.querySelector('.tpl-del'),
      selected: b.classList.contains('selected'),
    })),
  );
  const myEntry = tplEntries.find((e) => e.text.includes('e2e-mytpl'));
  const distEntry = tplEntries.find((e) => e.text.includes('seizo-std'));
  // 実体化コピー方式(2026-07-22 決定): テンプレート適用は一度きりのコピーで
  // 持続的な選択状態を持たないため，一覧に選択中チェックは出ない
  // (selectedTemplateId は常に非選択の値をコンテナが渡す)。
  check(
    'template list shows personal/dist badges (delete only on personal)',
    !!myEntry && myEntry.text.includes('個人') && myEntry.del && !myEntry.selected &&
      !!distEntry && distEntry.text.includes('配布') && !distEntry.del && !distEntry.selected,
  );
  // テンプレートを適用(実体化コピー方式: 現在の項目を全置換)
  await page.evaluate(() => {
    const e = [...document.querySelectorAll('tm-add-feature-dialog .entry')].find((b) =>
      b.textContent?.includes('e2e-mytpl'),
    );
    e?.click();
  });
  await sleep(900);
  const itemsAfterApply = await page.evaluate(async () => {
    const r = await fetch('/api/v1/me/dash-items').then((x) => x.json());
    return r.items;
  });
  check('applying personal template replaces dash items', itemsAfterApply.length > 0);

  // 個人テンプレートの削除 → 一覧から消えるが，適用済みのコピーはそのまま残る
  // (2026-07-22 決定: テンプレートへの参照ではなくコピーのため波及しない)
  await page.click('button.fab');
  await sleep(300);
  await clickByText(page, 'tm-add-feature-dialog button.entry', 'テンプレート');
  await sleep(300);
  await clickByText(page, 'tm-add-feature-dialog button.entry', 'テンプレートを選択');
  await sleep(400);
  await page.evaluate(() => {
    const e = [...document.querySelectorAll('tm-add-feature-dialog .entry')].find((b) =>
      b.textContent?.includes('e2e-mytpl'),
    );
    e?.querySelector('.tpl-del')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await sleep(1200);
  // ブラウザ側関数から Node 側変数は参照できないため件数を引数で渡す
  const afterDel = await page.evaluate(async (expectedLen) => {
    const tpls = await fetch('/api/v1/dash-templates').then((x) => x.json());
    const items = await fetch('/api/v1/me/dash-items').then((x) => x.json());
    return {
      gone: !tpls.templates.some((t) => t.name === 'e2e-mytpl'),
      itemsUnaffected: items.items.length === expectedLen,
    };
  }, itemsAfterApply.length);
  check(
    'deleting personal template does not affect the already-applied copy',
    afterDel.gone && afterDel.itemsUnaffected,
  );
  // 後始末: 以降のテストに影響しないよう項目を空に戻す(0件=空表示)
  await page.evaluate(async () => {
    await fetch('/api/v1/me/dash-items', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [] }),
    });
  });
  await page.keyboard.press('Escape');
  await sleep(200);
  await page.keyboard.press('Escape');
  await sleep(200);
  await page.keyboard.press('Escape');
  await sleep(300);

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
  await page.goto(BASE + '/settings/table-maint', { waitUntil: 'networkidle2' });
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

  // 編集ダイアログ: 現在値が入り，空にして保存すると制限解除される
  await page.evaluate(() => {
    const tr = [...document.querySelectorAll('table.table tbody tr')].find((r) =>
      r.textContent?.includes('e2e-restricted'),
    );
    tr?.querySelector('.icon-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
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
    tr?.querySelector('.icon-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
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
  // 固定表示・入力無効化され，候補もそのスキーマだけになる
  await page.evaluate(() => {
    [...document.querySelectorAll('.mat-mdc-tab-link')].find((b) => b.textContent?.includes('管理テーブル'))?.click();
  });
  await sleep(500);
  await clickByText(page, 'button.primary', 'テーブルを登録');
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
        connectionId: connId, schemaName: 'dbo', tableName: 'bigdata', displayName: 'e2e-reject-test',
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

  // 9) sato(user): サイドバーに履歴/設定なし，/history は弾かれる
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
