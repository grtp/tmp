import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import angular from 'angular-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist', '**/out-tsc', '**/.angular', '**/.nx', 'coverage'],
  },
  {
    files: ['**/*.ts'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      ...angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'tm', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'tm', style: 'kebab-case' },
      ],
    },
  },
  {
    files: ['**/*.html'],
    extends: [
      ...angular.configs.templateRecommended,
      ...angular.configs.templateAccessibility,
    ],
    rules: {},
  },
  {
    // レイヤ境界: libs/ui は表示専用で,アプリ側(apps/)や API 層を知らない。
    // 旧 @nx/enforce-module-boundaries の置き換え。
    files: ['libs/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/apps/**', '@f-tool/ui'],
              message:
                'libs/ui からアプリ側(apps/)や自身の公開 API(@f-tool/ui)を import しない(表示専用ライブラリ)',
            },
          ],
        },
      ],
    },
  },
);
