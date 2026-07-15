import { applicationConfig, type Preview } from '@storybook/angular';

import { provideForgeI18n } from '../src/lib/shared/i18n/provide-i18n';

const preview: Preview = {
  decorators: [
    // コンポーネントが transloco パイプを使うため、アプリと同じ i18n
    // プロバイダを登録する(辞書はバンドル同梱、既定 ja)。
    applicationConfig({
      providers: [provideForgeI18n('ja')],
    }),
  ],
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};
export default preview;
