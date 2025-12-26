import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import prettierRecommendedConfig from 'eslint-plugin-prettier/recommended';
import importPlugin from 'eslint-plugin-import';

export default defineConfig(
	{ ignores: ['dist'] },
	{
		extends: [js.configs.recommended, ...tseslint.configs.recommended],
		files: ['**/*.{ts,tsx}'],
		languageOptions: {
			ecmaVersion: 2020,
		},
		plugins: {
			import: importPlugin,
		},
		settings: {
			'import/resolver': {
				typescript: true,
			},
		},
		rules: {
			'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
			'no-debugger': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
			// Allow unused variables if they are prefixed with _
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					caughtErrorsIgnorePattern: '^_',
				},
			],
			'import/order': [
				'off',
				{
//					'newlines-between': 'always',
//					alphabetize: {
//						order: 'asc',
//						caseInsensitive: true,
//					},
				},
			],
		},
	},
	prettierRecommendedConfig,
	// Override Prettier error → warning
	{
		rules: {
			'prettier/prettier': 'warn',
		},
	},
);
