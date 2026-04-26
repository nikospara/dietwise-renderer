import { test, expect } from '@playwright/test';

test('GET /health returns ok', async ({ request, baseURL }) => {
	const res = await request.get(`${baseURL}/health`);
	expect(res.status()).toBe(200);
	await expect(res.json()).resolves.toEqual({ ok: true });
});
