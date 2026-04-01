import { defineConfig } from 'vite';
import eslintPlugin from '@nabla/vite-plugin-eslint';
import path from 'path';
import { configDefaults } from 'vitest/config';

/**
 * @see https://vitejs.dev/config/
 */
export default defineConfig(({ mode }) => {
	const isTest = mode === 'test';

	return {
		plugins: isTest ? [] : [eslintPlugin()],
		resolve: {
			tsconfigPaths: true,
			alias: {
				'@': path.resolve('./src'),
			},
		},
		test: {
			environment: 'jsdom', // Required for DOM-based tests
			globals: true, // So we can use describe/it/expect directly
			include: ['src/**/*.test.ts'],
			exclude: [...configDefaults.exclude, 'dist/**', 'tests/**'],
			coverage: {
				provider: 'v8',
				reporter: ['text', 'html'],
			},
		},
	};
});
