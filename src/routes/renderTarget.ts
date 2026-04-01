import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const TEST_URL_RE = /^[0-9]{3}\.html$/;

type LookupResult = {
	address: string;
	family: number;
};

export type HostLookup = (hostname: string, options: { all: true; verbatim: true }) => Promise<LookupResult[]>;

export class InvalidRenderTargetError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'InvalidRenderTargetError';
	}
}

export interface TestRenderTarget {
	kind: 'test';
	fileName: string;
}

export interface RemoteRenderTarget {
	kind: 'remote';
	url: string;
}

export type RenderTarget = TestRenderTarget | RemoteRenderTarget;

export interface RenderTargetValidationOptions {
	testDir?: string;
	lookup?: HostLookup;
}

export async function validateRenderTarget(
	rawUrl: string,
	options: RenderTargetValidationOptions = {},
): Promise<RenderTarget> {
	const candidate = rawUrl.trim();
	if (!candidate) {
		throw new InvalidRenderTargetError('Invalid or empty url');
	}

	if (options.testDir && TEST_URL_RE.test(candidate)) {
		return {
			kind: 'test',
			fileName: candidate,
		};
	}

	return {
		kind: 'remote',
		url: await validateRemoteRenderUrl(candidate, options.lookup),
	};
}

export async function validateRemoteRenderUrl(rawUrl: string, lookupImpl: HostLookup = defaultLookup): Promise<string> {
	const candidate = rawUrl.trim();
	let parsed: URL;

	try {
		parsed = new URL(candidate);
	} catch {
		throw new InvalidRenderTargetError('URL must be absolute http/https or a test file name like 123.html');
	}

	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new InvalidRenderTargetError('Only http and https URLs are allowed');
	}
	if (parsed.username || parsed.password) {
		throw new InvalidRenderTargetError('URLs with embedded credentials are not allowed');
	}
	if (isBlockedHostname(parsed.hostname)) {
		throw new InvalidRenderTargetError(`Blocked hostname: ${parsed.hostname}`);
	}

	const addresses = await resolveHostname(parsed.hostname, lookupImpl);
	if (addresses.some((address) => isBlockedIpAddress(address))) {
		throw new InvalidRenderTargetError(`Blocked destination: ${parsed.hostname}`);
	}

	return parsed.toString();
}

async function resolveHostname(hostname: string, lookupImpl: HostLookup): Promise<string[]> {
	if (isIP(hostname)) {
		return [hostname];
	}

	try {
		const results = await lookupImpl(hostname, { all: true, verbatim: true });
		return results.map((result) => result.address);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new InvalidRenderTargetError(`Could not resolve hostname: ${message}`);
	}
}

const defaultLookup: HostLookup = (hostname, options) => dnsLookup(hostname, options);

function isBlockedHostname(hostname: string): boolean {
	const normalized = hostname.toLowerCase();

	return normalized === 'localhost' || normalized.endsWith('.localhost');
}

function isBlockedIpAddress(address: string): boolean {
	const family = isIP(address);
	if (family === 4) {
		return isBlockedIpv4(address);
	}
	if (family === 6) {
		return isBlockedIpv6(address);
	}
	return true;
}

function isBlockedIpv4(address: string): boolean {
	const parts = address.split('.').map((part) => Number(part));
	if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
		return true;
	}

	const [a, b] = parts;

	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 198 && (b === 18 || b === 19)) ||
		a >= 224
	);
}

function isBlockedIpv6(address: string): boolean {
	const normalized = address.toLowerCase();

	return (
		normalized === '::' ||
		normalized === '::1' ||
		normalized.startsWith('fc') ||
		normalized.startsWith('fd') ||
		normalized.startsWith('fe8') ||
		normalized.startsWith('fe9') ||
		normalized.startsWith('fea') ||
		normalized.startsWith('feb')
	);
}
