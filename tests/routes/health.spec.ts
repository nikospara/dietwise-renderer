import { test, expect } from '@playwright/test';

test('GET /health returns ok', async ({ request, baseUrl }) => {
	const res = await request.get(`${baseUrl}/health`);
	expect(res.status()).toBe(200);
	await expect(res.json()).resolves.toEqual({ ok: true });
});
