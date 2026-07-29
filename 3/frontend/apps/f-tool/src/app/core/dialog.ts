import { ComponentType } from '@angular/cdk/portal';
import {
  MatDialog,
  MatDialogConfig,
  MatDialogRef,
} from '@angular/material/dialog';
import { TranslocoService } from '@jsverse/transloco';
import { ConfirmData, ConfirmDialog } from '@f-tool/ui';

import { apiErrorText } from './api-errors';

/**
 * openModal は F-tool 規約でモーダルを開く。画面外クリックでは閉じない
 * (誤操作防止)。Esc は各ダイアログが busy を見て自分で閉じる。
 * ダイアログは API を呼ばず output を emit するだけで，開いた側が
 * componentInstance を購読して実行・close を握る。
 */
export function openModal<T, D>(
  dialog: MatDialog,
  component: ComponentType<T>,
  data?: D,
  config?: MatDialogConfig<D>,
): MatDialogRef<T> {
  // 旧カスタムダイアログは即座に表示/非表示していた(アニメーション無し)。
  // MatDialog の既定アニメーション(~200ms)は close() 直後に別要素へ素早く
  // 操作する自動テストでバックドロップの残存に引っかかるため，無効化して
  // 挙動を揃える。
  return dialog.open(component, {
    disableClose: true,
    enterAnimationDuration: '0ms',
    exitAnimationDuration: '0ms',
    ...config,
    data,
  });
}

/**
 * confirmAsync は確認ダイアログを開き，ユーザーの選択を boolean で返す。
 * ルーターの canDeactivate ガードなど「結果そのもの」が要る場面用
 * (confirmThen は承認時に action を実行する fire-and-forget 版)。
 */
export function confirmAsync(
  dialog: MatDialog,
  data: ConfirmData,
): Promise<boolean> {
  const ref = openModal(dialog, ConfirmDialog, data, {
    role: 'alertdialog',
    width: '24rem',
  });
  return new Promise((resolve) => {
    let ok = false;
    ref.componentInstance.confirmed.subscribe(() => {
      ok = true;
      ref.close();
    });
    // キャンセル/Esc はダイアログ自身が close する(confirmed は発火しない)
    ref.afterClosed().subscribe(() => resolve(ok));
  });
}

/**
 * confirmThen は確認ダイアログを開き，承認されたら action を実行する。
 * 実行中は busy(処理中表示)，完了後は成否に関わらず閉じる(失敗の通知は
 * action 側のエラーバナー等が担う。従来の onConfirmed と同じ挙動)。
 */
export function confirmThen(
  dialog: MatDialog,
  data: ConfirmData,
  action: () => Promise<void>,
): void {
  const ref = openModal(dialog, ConfirmDialog, data, {
    role: 'alertdialog',
    width: '24rem',
  });
  ref.componentInstance.confirmed.subscribe(() => {
    void (async () => {
      ref.componentRef?.setInput('busy', true);
      try {
        await action();
      } finally {
        ref.close();
      }
    })();
  });
}

/**
 * runDialogAction は「ダイアログ内の非同期処理」の定型
 * (saving 表示 → 実行 → 失敗ならエラーバナー → saving 解除)を1か所にまとめる。
 * 各種ダイアログ(RowEdit/Connection/ManagedTable/TemplateEditor 等)は
 * `saving: boolean` / `errorMessage: string | null` の2 input を持つ規約。
 *
 * 成功時に閉じる(ref.close())かどうかは run() 側の責務のままにする
 * (「保存後すぐ閉じる」「ダイアログを開いたまま一覧だけ更新する」等，
 * 呼び出し側で挙動が割れるため)。エラー内容の翻訳キーは呼び出し側が
 * fallbackKey で指定する(create/update で文言を変える箇所があるため)。
 */
export async function runDialogAction<T>(
  transloco: TranslocoService,
  ref: MatDialogRef<T>,
  fallbackKey: string,
  run: () => Promise<void>,
): Promise<void> {
  ref.componentRef?.setInput('saving', true);
  ref.componentRef?.setInput('errorMessage', null);
  try {
    await run();
  } catch (err) {
    ref.componentRef?.setInput(
      'errorMessage',
      apiErrorText(transloco, err, fallbackKey),
    );
  } finally {
    ref.componentRef?.setInput('saving', false);
  }
}
