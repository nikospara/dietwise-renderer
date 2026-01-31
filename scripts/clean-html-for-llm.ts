#!/usr/bin/env tsx
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { cleanHtmlForLLM, DEFAULT_ALLOWED_TAGS, RECIPE_MINIMAL_TAGS } from '../src/cleaner/cleanHtmlForLLM.js';
import { nodeDomAdapter } from '../src/cleaner/nodeDomAdapter.js';
import type { CleanOptions } from '../src/cleaner/cleanHtmlForLLM.js';

type CliResult = {
	inputPath: string;
	options: Partial<CleanOptions>;
	showHelp: boolean;
};

function printHelp(): void {
	const help = `Usage:
  tsx scripts/clean-html-for-llm.ts <path-to-html> [options]

Options:
  --allowed-tags <list>                Comma-separated tag list or keyword: default, recipe-minimal
  --drop-media | --no-drop-media       Drop media elements (default: true)
  --strict-urls | --no-strict-urls     Keep only http/https (default: true)
  --keep-tables | --no-keep-tables     Preserve minimal table tags (default: false)
  --max-depth <number>                 Max nodes to process (default: 200000)
  --apply-consent-ui-heuristics | --no-apply-consent-ui-heuristics
                                       Try to remove consent UI (default: true)
  --output-minimal-text | --no-output-minimal-text
                                       Output minimal text, not HTML (default: false)
  -h, --help                           Show this help

Examples:
  tsx scripts/clean-html-for-llm.ts ./page.html
  tsx scripts/clean-html-for-llm.ts ./page.html --allowed-tags recipe-minimal
  tsx scripts/clean-html-for-llm.ts ./page.html --keep-tables --no-drop-media
`;
	process.stdout.write(help);
}

function parseBoolean(value: string | undefined, flag: string): boolean {
	if (value === undefined) return true;
	const normalized = value.trim().toLowerCase();
	if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
	if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
	throw new Error(`Invalid boolean for ${flag}: ${value}`);
}

function parseAllowedTags(raw: string): Set<string> {
	const trimmed = raw.trim().toLowerCase();
	if (trimmed === 'default') return new Set(DEFAULT_ALLOWED_TAGS);
	if (trimmed === 'recipe-minimal') return new Set(RECIPE_MINIMAL_TAGS);
	const tags = raw
		.split(',')
		.map((t) => t.trim().toLowerCase())
		.filter(Boolean);
	if (tags.length === 0) throw new Error('allowed-tags must not be empty');
	return new Set(tags);
}

function parseArgs(argv: string[]): CliResult {
	let inputPath = '';
	const options: Partial<CleanOptions> = {};
	let showHelp = false;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg) continue;

		if (arg === '-h' || arg === '--help') {
			showHelp = true;
			continue;
		}

		if (!arg.startsWith('-')) {
			if (!inputPath) {
				inputPath = arg;
				continue;
			}
			throw new Error(`Unexpected argument: ${arg}`);
		}

		if (arg.startsWith('--allowed-tags=')) {
			options.allowedTags = parseAllowedTags(arg.split('=', 2)[1] ?? '');
			continue;
		}
		if (arg === '--allowed-tags') {
			const value = argv[++i];
			if (!value) throw new Error('Missing value for --allowed-tags');
			options.allowedTags = parseAllowedTags(value);
			continue;
		}

		if (arg === '--drop-media' || arg.startsWith('--drop-media=')) {
			const value = arg.includes('=') ? arg.split('=', 2)[1] : undefined;
			options.dropMedia = parseBoolean(value, '--drop-media');
			continue;
		}
		if (arg === '--no-drop-media') {
			options.dropMedia = false;
			continue;
		}

		if (arg === '--strict-urls' || arg.startsWith('--strict-urls=')) {
			const value = arg.includes('=') ? arg.split('=', 2)[1] : undefined;
			options.strictUrls = parseBoolean(value, '--strict-urls');
			continue;
		}
		if (arg === '--no-strict-urls') {
			options.strictUrls = false;
			continue;
		}

		if (arg === '--keep-tables' || arg.startsWith('--keep-tables=')) {
			const value = arg.includes('=') ? arg.split('=', 2)[1] : undefined;
			options.keepTables = parseBoolean(value, '--keep-tables');
			continue;
		}
		if (arg === '--no-keep-tables') {
			options.keepTables = false;
			continue;
		}

		if (arg.startsWith('--max-depth=')) {
			const value = arg.split('=', 2)[1];
			const parsed = Number.parseInt(value ?? '', 10);
			if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid max depth: ${value}`);
			options.maxDepth = parsed;
			continue;
		}
		if (arg === '--max-depth') {
			const value = argv[++i];
			if (!value) throw new Error('Missing value for --max-depth');
			const parsed = Number.parseInt(value, 10);
			if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid max depth: ${value}`);
			options.maxDepth = parsed;
			continue;
		}

		if (arg === '--apply-consent-ui-heuristics' || arg.startsWith('--apply-consent-ui-heuristics=')) {
			const value = arg.includes('=') ? arg.split('=', 2)[1] : undefined;
			options.applyConsentUiHeuristics = parseBoolean(value, '--apply-consent-ui-heuristics');
			continue;
		}
		if (arg === '--no-apply-consent-ui-heuristics') {
			options.applyConsentUiHeuristics = false;
			continue;
		}

		if (arg === '--output-minimal-text' || arg.startsWith('--output-minimal-text=')) {
			const value = arg.includes('=') ? arg.split('=', 2)[1] : undefined;
			options.outputMinimalText = parseBoolean(value, '--output-minimal-text');
			continue;
		}
		if (arg === '--no-output-minimal-text') {
			options.outputMinimalText = false;
			continue;
		}

		throw new Error(`Unknown option: ${arg}`);
	}

	return { inputPath, options, showHelp };
}

async function main() {
	const { inputPath, options, showHelp } = parseArgs(process.argv.slice(2));
	if (showHelp || !inputPath) {
		printHelp();
		if (!inputPath) process.exitCode = 1;
		return;
	}

	const testDir = process.env.DW_RENDERER_TEST_DIR;
	const finalInputPath =
		testDir && /^[0-9]{3}[a-z]?\.html$/.test(inputPath) ? path.join(testDir, inputPath) : inputPath;
	const html = await readFile(finalInputPath, 'utf8');
	const result = cleanHtmlForLLM(html, nodeDomAdapter, options);
	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((err) => {
	const message = err instanceof Error ? err.message : String(err);
	process.stderr.write(`${message}\n`);
	process.exit(1);
});
