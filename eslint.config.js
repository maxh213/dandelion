import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  {
    ignores: ['dist', 'coverage', 'node_modules', 'ts-coverage', 'qa', '.marestail', '.stryker-tmp', '.dependency-cruiser.cjs']
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'complexity': ['error', 4]
    }
  }
);
