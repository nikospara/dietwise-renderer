export async function withHardTimeout<T>(
	task: Promise<T>,
	timeoutMs: number,
	onTimeout: () => Promise<void>,
): Promise<T> {
	let timeoutHandle: NodeJS.Timeout;

	const timeoutPromise = new Promise<never>((_, reject) => {
		timeoutHandle = setTimeout(async () => {
			try {
				await onTimeout();
			} catch (e) {
				// ignore cleanup errors, but log them for completeness
				console.warn('Error in onTimeout() - will be ignored', e);
			}
			reject(new Error('Hard timeout exceeded'));
		}, timeoutMs);
	});

	try {
		return await Promise.race([task, timeoutPromise]);
	} finally {
		clearTimeout(timeoutHandle!);
	}
}
