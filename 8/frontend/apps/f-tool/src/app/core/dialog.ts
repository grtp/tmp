import { ComponentType } from '@angular/cdk/portal';
import {
  MatDialog,
  MatDialogConfig,
  MatDialogRef,
} from '@angular/material/dialog';
import { ConfirmData, ConfirmDialog } from '@f-tool/ui';

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
