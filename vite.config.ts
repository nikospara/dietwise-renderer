import { defineConfig } from 'vite';
import eslintPlugin from '@nabla/vite-plugin-eslint';
import path from 'path';
import tsconfigPaths from 'vite-tsconfig-paths';
import { configDefaults } from 'vitest/config';

/**
 * @see https://vitejs.dev/config/
 */
export default defineConfig((_arg) => {
	return {
		plugins: [tsconfigPaths(), eslintPlugin()],
		resolve: {
			alias: {
				'@': path.resolve('./src'),
			},
		},
		test: {
			environment: 'jsdom', // Required for DOM-based tests
			globals: true, // So we can use describe/it/expect directly
			exclude: [...configDefaults.exclude],
			coverage: {
				provider: 'v8',
				reporter: ['text', 'html'],
			},
		},
	};
});
