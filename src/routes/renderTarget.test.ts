import { describe, expect, it } from 'vitest';
import { InvalidRenderTargetError, validateRemoteRenderUrl, validateRenderTarget } from 'app/routes/renderTarget.js';

describe('validateRenderTarget', () => {
	it('allows test fixture names only when they match the strict regex and test dir is configured', async () => {
		await expect(validateRenderTarget('123.html', { testDir: 'C:\\fixtures' })).resolves.toEqual({
			kind: 'test',
			fileName: '123.html',
		});
	});

	it('rejects non-matching fixture-like names', async () => {
		await expect(validateRenderTarget('0123.html', { testDir: 'C:\\fixtures' })).rejects.toBeInstanceOf(
			InvalidRenderTargetError,
		);
		await expect(validateRenderTarget('123a.html', { testDir: 'C:\\fixtures' })).rejects.toBeInstanceOf(
			InvalidRenderTargetError,
		);
		await expect(validateRenderTarget('../123.html', { testDir: 'C:\\fixtures' })).rejects.toBeInstanceOf(
			InvalidRenderTargetError,
		);
	});

	it('requires absolute http or https URLs outside test mode', async () => {
		const lookup = async () => [{ address: '93.184.216.34', family: 4 as const }];

		await expect(validateRenderTarget('123.html', { lookup })).rejects.toBeInstanceOf(InvalidRenderTargetError);
		await expect(validateRenderTarget('https://example.com/recipe', { lookup })).resolves.toEqual({
			kind: 'remote',
			url: 'https://example.com/recipe',
		});
	});
});

describe('validateRemoteRenderUrl', () => {
	it('rejects unsupported protocols and embedded credentials', async () => {
		await expect(validateRemoteRenderUrl('ftp://example.com')).rejects.toBeInstanceOf(InvalidRenderTargetError);
		await expect(validateRemoteRenderUrl('file:///tmp/test.html')).rejects.toBeInstanceOf(InvalidRenderTargetError);
		await expect(validateRemoteRenderUrl('http://user:pass@example.com')).rejects.toBeInstanceOf(
			InvalidRenderTargetError,
		);
	});

	it('rejects localhost and literal private IPs', async () => {
		await expect(validateRemoteRenderUrl('http://localhost:3000')).rejects.toBeInstanceOf(InvalidRenderTargetError);
		await expect(validateRemoteRenderUrl('http://127.0.0.1')).rejects.toBeInstanceOf(InvalidRenderTargetError);
		await expect(validateRemoteRenderUrl('http://10.0.0.5')).rejects.toBeInstanceOf(InvalidRenderTargetError);
		await expect(validateRemoteRenderUrl('http://[::1]/')).rejects.toBeInstanceOf(InvalidRenderTargetError);
	});

	it('rejects hostnames that resolve to internal addresses', async () => {
		const lookup = async () => [{ address: '192.168.1.10', family: 4 as const }];

		await expect(validateRemoteRenderUrl('https://internal.example', lookup)).rejects.toBeInstanceOf(
			InvalidRenderTargetError,
		);
	});

	it('allows hostnames that resolve only to public addresses', async () => {
		const lookup = async () => [{ address: '93.184.216.34', family: 4 as const }];

		await expect(validateRemoteRenderUrl('https://example.com/path?q=1', lookup)).resolves.toBe(
			'https://example.com/path?q=1',
		);
	});
});
