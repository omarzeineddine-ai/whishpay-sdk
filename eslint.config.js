import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'docs', 'spike', 'scripts', 'examples'] },
  ...tseslint.configs.recommended,
);
