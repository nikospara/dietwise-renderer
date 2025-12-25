import type { Router } from 'express';
import { Router as createRouter } from 'express';

export function healthRouter(): Router {
	const router = createRouter();

	router.get('/health', (_req, res) => {
		res.status(200).json({ ok: true });
	});

	return router;
}
