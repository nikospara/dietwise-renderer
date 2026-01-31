#!/usr/bin/env tsx
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { cleanDocumentForLLM } from '../src/cleaner/cleanHtmlForLLM.js';
import { nodeDomAdapter } from '../src/cleaner/nodeDomAdapter.js';

type ControlRow = {
	fileName: string;
	url: string;
	expected: string[];
};

type ResultRow = {
	filename: string;
	url: string;
	outcome: 'PASS' | 'FAIL';
	mismatchesHtml: string[];
	mismatchesText: string[];
};

function unquote(value: string): string {
	const trimmed = value.trim();
	if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function parseControlFile(contents: string): ControlRow[] {
	const rows: ControlRow[] = [];
	for (const rawLine of contents.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		const cols = line.split('\t');
		if (cols.length < 3) continue;
		const fileName = cols[0].trim();
		const url = (cols[1] ?? '').trim();
		const expected = cols.slice(2).map(unquote).filter(Boolean);
		rows.push({ fileName, url, expected });
	}
	return rows;
}

function toWhitespaceRegex(value: string): RegExp {
	const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const pattern = escaped.replace(/ /g, '\\s+');
	return new RegExp(pattern, 'u');
}

async function main() {
	const root = process.cwd();
	const controlPath = path.join(root, 'testdata', '_control.csv');
	const controlText = await readFile(controlPath, 'utf8');
	const rows = parseControlFile(controlText);

	const results: ResultRow[] = [];

	for (const row of rows) {
		const htmlPath = path.join(root, 'testdata', row.fileName);
		const html = await readFile(htmlPath, 'utf8');

		const docHtml = nodeDomAdapter.parse(html);
		const htmlResult = cleanDocumentForLLM(docHtml, { outputMinimalText: false });
		const docMinimal = nodeDomAdapter.parse(html);
		const minimalResult = cleanDocumentForLLM(docMinimal, { outputMinimalText: true });

		const mismatchesHtml: string[] = [];
		const mismatchesText: string[] = [];
		for (const expected of row.expected) {
			const re = toWhitespaceRegex(expected);
			const htmlOk = re.test(htmlResult.output);
			const minimalOk = re.test(minimalResult.output);
			if (!htmlOk) mismatchesHtml.push(expected);
			if (!minimalOk) mismatchesText.push(expected);
		}

		results.push({
			filename: row.fileName,
			url: row.url,
			outcome: mismatchesHtml.length === 0 && mismatchesText.length === 0 ? 'PASS' : 'FAIL',
			mismatchesHtml,
			mismatchesText,
		});
	}

	process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
	if (results.some((row) => row.outcome === 'FAIL')) process.exitCode = 1;
}

main().catch((err) => {
	const message = err instanceof Error ? err.message : String(err);
	process.stderr.write(`${message}\\n`);
	process.exit(1);
});
