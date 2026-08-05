import { MatDialogRef } from '@angular/material/dialog';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';

import { PersonalSettingsDialog } from './personal-settings-dialog';

/* MatDialog 経由で開かれる前提のため,DI(ref)をモックして中身だけ表示する。 */
const withDialog = applicationConfig({
  providers: [{ provide: MatDialogRef, useValue: { close: () => undefined } }],
});

const meta: Meta<PersonalSettingsDialog> = {
  title: 'Dialogs/PersonalSettings',
  component: PersonalSettingsDialog,
  parameters: { layout: 'centered' },
  decorators: [withDialog],
  argTypes: {
    clockModeChanged: { action: 'clockModeChanged' },
    clockFormatChanged: { action: 'clockFormatChanged' },
  },
};
export default meta;

type Story = StoryObj<PersonalSettingsDialog>;

/** 既定(分表示) */
export const Default: Story = {
  args: {
    settings: { headerClock: 'minute', headerClockFormat: '' },
    version: 'dev',
  },
};

/** カスタム書式(入力欄+プレビュー) */
export const CustomFormat: Story = {
  args: {
    settings: { headerClock: 'custom', headerClockFormat: 'yyyy/MM/dd (E) HH:mm' },
    version: 'dev',
  },
};

/** 保存失敗 */
export const WithError: Story = {
  args: {
    settings: { headerClock: 'minute', headerClockFormat: '' },
    errorMessage: '個人設定の更新に失敗しました',
  },
};
