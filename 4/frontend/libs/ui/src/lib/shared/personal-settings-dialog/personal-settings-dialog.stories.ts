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
  argTypes: { headerClockSecondsChanged: { action: 'headerClockSecondsChanged' } },
};
export default meta;

type Story = StoryObj<PersonalSettingsDialog>;

/** 既定(秒表示オフ) */
export const Default: Story = {
  args: { settings: { headerClockSeconds: false } },
};

/** 秒表示オン */
export const SecondsOn: Story = {
  args: { settings: { headerClockSeconds: true } },
};

/** 保存失敗 */
export const WithError: Story = {
  args: {
    settings: { headerClockSeconds: false },
    errorMessage: '個人設定の更新に失敗しました',
  },
};
