import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/** 編集対象の初期値(パスワードは含まれない = API が返さない)。 */
export interface ConnectionDraft {
  name: string;
  host: string;
  port: number;
  databaseName: string;
  username: string;
  options?: string;
  schemaName?: string;
  enabled: boolean;
}

/** 保存/テスト時にダイアログが出す値。password は空文字 = 変更なし(編集時)。 */
export interface ConnectionSubmit extends ConnectionDraft {
  password: string;
}

/**
 * 接続の登録/編集ダイアログ(admin)。
 * - 新規: パスワード必須
 * - 編集: パスワード空欄 = 変更しない
 * - [接続テスト] は保存前に現在の入力値で疎通確認する
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'tm-connection-dialog',
  imports: [TranslocoPipe],
  templateUrl: './connection-dialog.html',
  styleUrl: './connection-dialog.css',
})
export class ConnectionDialog {
  readonly open = input(false);
  readonly mode = input<'create' | 'edit'>('create');
  /** 編集時の初期値(open 時に取り込む) */
  readonly value = input<ConnectionDraft | null>(null);
  readonly saving = input(false);
  readonly testing = input(false);
  readonly errorMessage = input<string | null>(null);
  /** 接続テスト結果("OK (12ms)" / エラー文言)。コンテナが管理 */
  readonly testResult = input<string | null>(null);

  readonly saved = output<ConnectionSubmit>();
  readonly testClicked = output<ConnectionSubmit>();
  readonly cancelled = output<void>();

  protected readonly name = signal('');
  protected readonly host = signal('');
  protected readonly port = signal(1433);
  protected readonly databaseName = signal('');
  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly options = signal('');
  protected readonly schemaName = signal('');

  protected readonly canTest = computed(
    () =>
      this.host().trim() !== '' &&
      this.databaseName().trim() !== '' &&
      this.username().trim() !== '' &&
      (this.mode() === 'edit' || this.password() !== ''),
  );

  protected readonly canSave = computed(
    () =>
      this.name().trim() !== '' &&
      this.host().trim() !== '' &&
      this.databaseName().trim() !== '' &&
      this.username().trim() !== '' &&
      (this.mode() === 'edit' || this.password() !== ''),
  );

  constructor() {
    effect(() => {
      if (this.open()) {
        const v = this.value();
        this.name.set(v?.name ?? '');
        this.host.set(v?.host ?? '');
        this.port.set(v?.port ?? 1433);
        this.databaseName.set(v?.databaseName ?? '');
        this.username.set(v?.username ?? '');
        this.password.set('');
        this.options.set(v?.options ?? '');
        this.schemaName.set(v?.schemaName ?? '');
      }
    });
  }

  private submit(): ConnectionSubmit {
    return {
      name: this.name().trim(),
      host: this.host().trim(),
      port: this.port() || 1433,
      databaseName: this.databaseName().trim(),
      username: this.username().trim(),
      password: this.password(),
      options: this.options().trim() || undefined,
      // 空文字も明示的に送る(編集時に既存のスキーマ制限を解除できるようにするため。
      // options 等と違い「空欄 = 変更なし」ではなく「空欄 = 制限なし」を表す)。
      schemaName: this.schemaName().trim(),
      enabled: this.value()?.enabled ?? true,
    };
  }

  protected test(): void {
    this.testClicked.emit(this.submit());
  }

  protected save(): void {
    this.saved.emit(this.submit());
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.open() && !this.saving() && !this.testing()) {
      this.cancelled.emit();
    }
  }
}
