import {
  AfterViewInit,
  Directive,
  ElementRef,
  OnDestroy,
  inject,
  input,
} from '@angular/core';

const MIN_COL_WIDTH = 60;
const HANDLE_MARK = 'data-tm-resize-handle';
const FILLER_MARK = 'data-tm-filler';
/** 読込中プレースホルダ行の目印(利用側テンプレートが付与)。 */
const LOADING_MARK = 'data-tm-loading';
/** autoFit の列幅の下限(フィルタ入力が収まる幅)と上限(長文セル) */
const AUTOFIT_MIN = 90;
const AUTOFIT_MAX = 480;

/**
 * 任意の <table> に列幅ドラッグ調整を付ける共通ディレクティブ。
 *
 *   <table [tmResizeColumns]="'ftool.colw:settings:users'">
 *
 * - th の右端をドラッグで幅変更(最小 60px)，ダブルクリックでリセット
 * - storage key を渡すと localStorage にユーザー端末単位で永続化
 * - 幅のキーは th の data-col 属性(あれば)，無ければ列インデックス。
 *   同じテーブル(=同じキー)なら再訪時に幅が復元される
 * - MutationObserver で th の増減(非同期描画/タブ切替)に追従する
 */
@Directive({
  selector: 'table[tmResizeColumns]',
})
export class TmResizeColumnsDirective implements AfterViewInit, OnDestroy {
  /** localStorage のキー。'' = 永続化なし(リサイズ自体は可能) */
  readonly tmResizeColumns = input<string>('');
  /**
   * true で各列を内容幅に自動フィットし，末尾に**疑似カラム(フィラー列)**を
   * 足して余白を吸収させる。全ての実列は px 固定なので，リサイズは常に
   * 「その列だけ」が変わり(フィラーが伸縮を引き受ける)，列合計が
   * コンテナ幅を超えるとフィラーが 0 になって横スクロールへ切り替わる。
   * ウィンドウ伸縮への追従はブラウザの fixed レイアウトに任せる(JS 不要)。
   * (CSS の percent/width 指定では Chromium が列を min-content 以下に
   *  潰すため，実測 px の焼き付けは JS で行う)
   */
  readonly tmAutoFit = input(false);

  private el = inject(ElementRef<HTMLTableElement>);
  private observer: MutationObserver | null = null;
  private widths: Record<string, number> = {};
  private loadedKey: string | null = null;
  private rebuildScheduled = false;
  /** autoFit 済みの状態(列構成 + データ有無)。変わったら再フィット */
  private fitSignature = '';

  ngAfterViewInit(): void {
    this.rebuild();
    // 非同期でヘッダー行が描画される/列数が変わるケースに追従する。
    // 自前のハンドル/フィラー追加もイベントを起こすが，rebuild は冪等なので無害。
    this.observer = new MutationObserver(() => this.scheduleRebuild());
    const thead = this.el.nativeElement.querySelector('thead');
    if (thead) {
      this.observer.observe(thead, { childList: true, subtree: true });
    }
    // autoFit はデータ到着/行入替でフィラー td の再付与が要るため tbody も見る。
    const tbody = this.el.nativeElement.querySelector('tbody');
    if (this.tmAutoFit() && tbody) {
      this.observer.observe(tbody, { childList: true });
    }
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  private scheduleRebuild(): void {
    if (this.rebuildScheduled) return;
    this.rebuildScheduled = true;
    requestAnimationFrame(() => {
      this.rebuildScheduled = false;
      this.rebuild();
    });
  }

  /** 実列の th(フィラーは含めない)。 */
  private headerCells(): HTMLTableCellElement[] {
    const row = this.el.nativeElement.querySelector('thead tr');
    if (!row) return [];
    return (Array.from(row.children) as HTMLTableCellElement[]).filter(
      (th) => !th.hasAttribute(FILLER_MARK),
    );
  }

  private keyOf(th: HTMLTableCellElement, index: number): string {
    return th.dataset['col'] ?? String(index);
  }

  private rebuild(): void {
    const table = this.el.nativeElement;
    const ths = this.headerCells();
    if (ths.length === 0) return;

    const storageKey = this.tmResizeColumns();
    if (storageKey !== this.loadedKey) {
      this.widths = storageKey ? loadWidths(storageKey) : {};
      this.loadedKey = storageKey;
    }

    table.style.tableLayout = 'fixed';
    const useFiller = this.tmAutoFit();

    // colgroup を実列数(+フィラー1列)に合わせて用意する。
    let colgroup = table.querySelector(':scope > colgroup');
    if (!colgroup) {
      colgroup = document.createElement('colgroup');
      table.insertBefore(colgroup, table.firstChild);
    }
    // colgroup 自体は let だが,ここから先は再代入しない安定参照。
    // realCols クロージャに非null のまま渡すための const エイリアス
    // (let のままだと closure 内で TS が再度 null 許容型に戻してしまう)。
    const colgroupEl = colgroup;
    let fillerCol = colgroupEl.querySelector(
      `col[${FILLER_MARK}]`,
    ) as HTMLTableColElement | null;
    if (fillerCol && !useFiller) {
      fillerCol.remove();
      fillerCol = null;
    }
    const realCols = () =>
      (Array.from(colgroupEl.children) as HTMLTableColElement[]).filter(
        (c) => !c.hasAttribute(FILLER_MARK),
      );
    while (realCols().length < ths.length) {
      const col = document.createElement('col');
      // フィラーは常に末尾(実列はその手前へ挿入)。
      colgroup.insertBefore(col, fillerCol);
    }
    while (realCols().length > ths.length) {
      const cols = realCols();
      colgroup.removeChild(cols[cols.length - 1]);
    }
    if (useFiller) {
      if (!fillerCol) {
        fillerCol = document.createElement('col');
        fillerCol.setAttribute(FILLER_MARK, '1');
      }
      colgroup.appendChild(fillerCol); // 既存でも末尾へ移動(列追加後の整列)
      fillerCol.style.width = ''; // 幅なし = 余白を全部吸収(fixed レイアウト任せ)
    }

    if (useFiller) {
      this.autoFitIfNeeded(table, ths);
      this.syncFillerCells(table, ths.length);
    }

    const cols = realCols();
    ths.forEach((th, i) => {
      const col = cols[i];
      const w = this.widths[this.keyOf(th, i)];
      if (w) {
        col.style.width = `${w}px`;
      }

      if (th.hasAttribute('data-no-resize')) return; // 幅固定列(チェックボックス等)
      if (th.querySelector(`[${HANDLE_MARK}]`)) return; // ハンドル付与済み
      // ハンドルの absolute 配置の基準にする。sticky も包含ブロックになるため，
      // CSS 側で sticky を当てているヘッダー(固定表示)は上書きしない。
      if (getComputedStyle(th).position === 'static') {
        th.style.position = 'relative';
      }
      const handle = document.createElement('span');
      handle.setAttribute(HANDLE_MARK, '1');
      handle.setAttribute('aria-hidden', 'true');
      // th は overflow:hidden のため，はみ出しはヒットできない。
      // ハンドルは th の内側(境界の左 12px)に収める。
      Object.assign(handle.style, {
        position: 'absolute',
        top: '0',
        right: '0',
        width: '12px',
        height: '100%',
        cursor: 'col-resize',
        zIndex: '1',
      } satisfies Partial<CSSStyleDeclaration>);
      // ホバーで境界側をハイライトして「掴める」ことを示す
      handle.addEventListener('pointerenter', () => {
        handle.style.background =
          'linear-gradient(to left, rgba(62,105,173,0.55) 3px, transparent 3px)';
      });
      handle.addEventListener('pointerleave', () => {
        handle.style.background = '';
      });
      // col/index は捕捉しない: 列が後から途中挿入されるテーブル
      // (ユーザー権限の機能列など)では作成時点の対応がずれるため,
      // 操作時に th の現在位置から毎回解決する。
      handle.addEventListener('pointerdown', (e) => this.startResize(e, th));
      handle.addEventListener('dblclick', () => this.resetWidth(th));
      th.appendChild(handle);
    });
  }

  /**
   * 疑似カラムのセルを thead / tbody の各行に付与する。
   * 実列の右に区切り線付きの「もう1列」が現れ，テーブル右端まで広がる
   * (実列だけでコンテナ幅を使い切っている間はフィラー幅 0 = 実質不可視)。
   * Angular が行を再描画するとフィラー td は消えるため，tbody の
   * MutationObserver -> rebuild 経由で毎回付け直す(冪等)。
   */
  private syncFillerCells(table: HTMLTableElement, realCount: number): void {
    table.querySelectorAll(':scope > thead > tr').forEach((row) => {
      if (row.querySelector(`[${FILLER_MARK}]`)) return;
      const ref = row.lastElementChild;
      if (!ref) return;
      row.appendChild(makeFillerCell(ref));
    });
    table.querySelectorAll(':scope > tbody > tr').forEach((row) => {
      if (row.querySelector(`[${FILLER_MARK}]`)) return;
      const cells = Array.from(row.children) as HTMLTableCellElement[];
      // colspan 行(空表示など)や列数が合わない行には付けない。
      if (cells.length !== realCount) return;
      if (cells.some((c) => c.hasAttribute('colspan'))) return;
      row.appendChild(makeFillerCell(cells[cells.length - 1]));
    });
  }

  /**
   * 列構成またはデータ有無が変わった時だけ内容幅を測り，**全実列**(保存幅が
   * あればそちら)を px で焼き付ける(ページ送りごとに列幅が揺れないように，
   * 初回データ表示時の幅で固定する)。余白はフィラー列が吸収する。
   */
  private autoFitIfNeeded(
    table: HTMLTableElement,
    ths: HTMLTableCellElement[],
  ): void {
    const tbody = table.querySelector('tbody');
    // 読込中は「データ有無」がまだ確定していないため測らない(前回の幅を
    // 維持する)。ここで空扱いにして測ってしまうと,直後に実データが届いた
    // 際もう一度フィットし直すことになり,列幅が一瞬狭まって広がる
    // ちらつきが出る(ページ送りの度に読込行を経由するため毎回起こる)。
    if (tbody?.querySelector(`[${LOADING_MARK}]`)) return;
    const hasData = !!tbody?.querySelector('td:not([colspan])');
    const sig =
      ths.map((th, i) => this.keyOf(th, i)).join(',') +
      '|' +
      (hasData ? 'd' : 'e');
    if (sig === this.fitSignature) return;
    this.fitSignature = sig;

    const colgroup = table.querySelector(':scope > colgroup');
    if (!colgroup) return;
    const colEls = (
      Array.from(colgroup.children) as HTMLTableColElement[]
    ).filter((c) => !c.hasAttribute(FILLER_MARK));

    // 一時的に auto レイアウトへ切り替えて内容幅を実測する。
    const prevLayout = table.style.tableLayout;
    const prevWidth = table.style.width;
    const prevCols = colEls.map((c) => c.style.width);
    table.style.tableLayout = 'auto';
    table.style.width = 'auto';
    colEls.forEach((c) => (c.style.width = ''));
    const measured = ths.map((th) =>
      Math.min(
        AUTOFIT_MAX,
        Math.max(AUTOFIT_MIN, Math.ceil(th.getBoundingClientRect().width) + 2),
      ),
    );
    table.style.tableLayout = prevLayout || 'fixed';
    table.style.width = prevWidth;
    colEls.forEach((c, i) => (c.style.width = prevCols[i]));

    ths.forEach((th, i) => {
      if (th.hasAttribute('data-no-resize')) return; // チェック列は CSS の固定幅
      const saved = this.widths[this.keyOf(th, i)];
      colEls[i].style.width = `${saved ?? measured[i]}px`;
    });
  }

  /**
   * リサイズは「その列だけ」を変える。
   * - autoFit(フィラー列あり): 余白はフィラーが伸縮を引き受けるため，
   *   他の実列は動かない。フィラーが 0 の状態で広げるとテーブル幅ごと
   *   伸びて横スクロールになる(Excel 型)
   * - フィラー無しのテーブル(履歴/設定): 従来どおりのペアリサイズ
   *   (左列 +Δ / 右列 −Δ でテーブル全幅を変えない)
   */
  private startResize(e: PointerEvent, th: HTMLTableCellElement): void {
    e.preventDefault();
    e.stopPropagation();
    const table = this.el.nativeElement;
    const ths = this.headerCells();
    const colgroup = table.querySelector(':scope > colgroup');
    const cols = colgroup
      ? (Array.from(colgroup.children) as HTMLTableColElement[]).filter(
          (c) => !c.hasAttribute(FILLER_MARK),
        )
      : [];
    // th の現在位置から対象列を解決する(作成時 index は列挿入で古くなる)
    const index = ths.indexOf(th);
    const col = cols[index];
    if (index < 0 || !col) return;

    // フィラー列があるテーブルは単独リサイズ(ペアにしない)。
    const rightTh = this.tmAutoFit() ? undefined : ths[index + 1];
    const rightCol = this.tmAutoFit() ? undefined : cols[index + 1];
    const pair =
      !!rightTh && !!rightCol && !rightTh.hasAttribute('data-no-resize');

    const startX = e.clientX;
    const startLeft = th.getBoundingClientRect().left;
    const startWidth = th.getBoundingClientRect().width;
    const rightStart = pair ? rightTh.getBoundingClientRect().width : 0;
    // 幅未指定の列(余白吸収中)は実測を起点に固定してから動かす。
    if (!col.style.width) col.style.width = `${Math.round(startWidth)}px`;
    if (pair && rightCol && !rightCol.style.width) {
      rightCol.style.width = `${Math.round(rightStart)}px`;
    }

    const prevUserSelect = table.style.userSelect;
    table.style.userSelect = 'none';
    const guide = createGuideLine(table, e.clientX);

    const move = (ev: PointerEvent) => {
      let delta = Math.round(ev.clientX - startX);
      delta = Math.max(MIN_COL_WIDTH - startWidth, delta);
      if (pair) delta = Math.min(delta, rightStart - MIN_COL_WIDTH);

      const w = Math.round(startWidth + delta);
      col.style.width = `${w}px`;
      this.widths[this.keyOf(th, index)] = w;
      if (pair && rightTh && rightCol) {
        const rw = Math.round(rightStart - delta);
        rightCol.style.width = `${rw}px`;
        this.widths[this.keyOf(rightTh, index + 1)] = rw;
      }
      guide.style.left = `${startLeft + w}px`;
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      table.style.userSelect = prevUserSelect;
      guide.remove();
      this.persist();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  private resetWidth(th: HTMLTableCellElement): void {
    const ths = this.headerCells();
    const index = ths.indexOf(th);
    const colgroup = this.el.nativeElement.querySelector(':scope > colgroup');
    const cols = colgroup
      ? (Array.from(colgroup.children) as HTMLTableColElement[]).filter(
          (c) => !c.hasAttribute(FILLER_MARK),
        )
      : [];
    const col = cols[index];
    if (index < 0 || !col) return;
    delete this.widths[this.keyOf(th, index)];
    col.style.width = '';
    this.persist();
    // autoFit テーブルは内容幅の再計算で自然な幅に戻す。
    if (this.tmAutoFit()) {
      this.fitSignature = '';
      this.scheduleRebuild();
    }
  }

  private persist(): void {
    const key = this.tmResizeColumns();
    if (!key) return;
    try {
      if (Object.keys(this.widths).length === 0) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, JSON.stringify(this.widths));
      }
    } catch {
      // 永続化できない環境では黙ってスキップ(機能自体は動く)
    }
  }
}

/**
 * 隣(同じ行の最終セル)を浅くクローンしてフィラーセルを作る。
 * createElement だと Angular のスタイルスコープ属性(_ngcontent-*)が付かず，
 * コンポーネント CSS(th の背景色・td の罫線など)が当たらないため，
 * 属性ごと引き継いで同じ見た目にする。中身と列固有の属性は落とす。
 */
function makeFillerCell(ref: Element): HTMLElement {
  const cell = ref.cloneNode(false) as HTMLElement;
  cell.removeAttribute('data-col');
  cell.removeAttribute('data-no-resize');
  cell.removeAttribute('colspan');
  cell.removeAttribute('title');
  cell.className = ref.className; // スコープ用。check-td 等の固定幅クラスは外す
  cell.classList.remove('check-th', 'check-td');
  cell.style.width = '';
  cell.setAttribute(FILLER_MARK, '1');
  cell.setAttribute('data-no-resize', '1');
  cell.setAttribute('aria-hidden', 'true');
  return cell;
}

/** ドラッグ中の境界位置を示す縦ガイドライン(テーブルの高さぶん)。 */
function createGuideLine(table: HTMLTableElement, x: number): HTMLDivElement {
  const rect = (table.parentElement ?? table).getBoundingClientRect();
  const guide = document.createElement('div');
  Object.assign(guide.style, {
    position: 'fixed',
    top: `${rect.top}px`,
    height: `${rect.height}px`,
    left: `${x}px`,
    width: '2px',
    background: 'rgba(62, 105, 173, 0.7)',
    zIndex: '60',
    pointerEvents: 'none',
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(guide);
  return guide;
}

function loadWidths(key: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number' && v >= MIN_COL_WIDTH) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}
