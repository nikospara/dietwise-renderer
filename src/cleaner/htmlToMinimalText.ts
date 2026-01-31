import type { HtmlToDocumentAdapter } from './cleanHtmlForLLM.js';
import { getBodyElement } from './getBodyElement.js';

export interface MinimalTextOptions {
	/** Heading style: '#' repeated per level or a fixed prefix. */
	headingStyle?: 'hash' | 'prefix';
	/** Prefix when headingStyle is 'prefix'. */
	headingPrefix?: string;
	/** Bullet prefix for list items. */
	listMarker?: string;
	/** Separator between table cells. */
	tableCellSeparator?: string;
}

const DEFAULT_OPTIONS: Required<MinimalTextOptions> = {
	headingStyle: 'hash',
	headingPrefix: '#',
	listMarker: '-',
	tableCellSeparator: '\t',
};

const BLOCK_TAGS = new Set([
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'p',
	'ul',
	'ol',
	'li',
	'table',
	'thead',
	'tbody',
	'tfoot',
	'tr',
	'th',
	'td',
]);

export function htmlToMinimalText(html: string, adapter: HtmlToDocumentAdapter, options?: MinimalTextOptions): string {
	const doc = adapter.parse(html);
	return documentToMinimalText(doc, options);
}

export function documentToMinimalText(doc: Document, options?: MinimalTextOptions): string {
	const opts: Required<MinimalTextOptions> = { ...DEFAULT_OPTIONS, ...options };
	const body = getBodyElement(doc);

	const lines: string[] = [];

	const pushLine = (line: string) => {
		lines.push(line);
	};

	const pushSeparator = () => {
		if (lines.length === 0) return;
		if (lines[lines.length - 1] !== '') lines.push('');
	};

	const appendTextLines = (text: string, prefix = '') => {
		const parts = splitAndNormalize(text);
		for (let i = 0; i < parts.length; i++) {
			const part = parts[i];
			if (part.length === 0) continue;
			pushLine(i === 0 ? `${prefix}${part}` : part);
		}
	};

	const headingLine = (level: number, text: string) => {
		const cleaned = normalizeInline(text);
		if (!cleaned) return;
		if (opts.headingStyle === 'prefix') {
			pushLine(`${opts.headingPrefix} ${cleaned}`);
		} else {
			const prefix = '#'.repeat(Math.min(Math.max(level, 1), 6));
			pushLine(`${prefix} ${cleaned}`);
		}
	};

	const handleList = (listEl: Element) => {
		for (const li of Array.from(listEl.children)) {
			if (li.tagName.toLowerCase() !== 'li') continue;
			handleListItem(li);
		}
	};

	const handleListItem = (li: Element) => {
		let inline = '';
		for (const child of Array.from(li.childNodes)) {
			if (child.nodeType === 1 && isListElement(child as Element)) continue;
			inline += textFromInline(child);
		}
		appendTextLines(inline, `${opts.listMarker} `);

		for (const child of Array.from(li.children)) {
			if (isListElement(child)) handleList(child);
		}
	};

	const handleTable = (tableEl: Element) => {
		const rows = tableEl.querySelectorAll('tr');
		for (const row of Array.from(rows)) {
			const cells = row.querySelectorAll('th, td');
			const cellTexts = Array.from(cells).map((cell) => normalizeInline(textFromInline(cell)));
			const line = cellTexts.filter(Boolean).join(opts.tableCellSeparator);
			if (line) pushLine(line);
		}
	};

	const handleBlock = (el: Element) => {
		const tag = el.tagName.toLowerCase();
		switch (tag) {
			case 'h1':
			case 'h2':
			case 'h3':
			case 'h4':
			case 'h5':
			case 'h6':
				headingLine(Number(tag[1]), textFromInline(el));
				break;
			case 'p':
				appendTextLines(textFromInline(el));
				break;
			case 'ul':
			case 'ol':
				handleList(el);
				break;
			case 'li':
				handleListItem(el);
				break;
			case 'table':
				handleTable(el);
				break;
			default:
				appendTextLines(textFromInline(el));
		}
	};

	const processChildrenAsBlocks = (parent: Element) => {
		let inlineBuffer = '';
		for (const child of Array.from(parent.childNodes)) {
			if (child.nodeType === 1 && isBlockElement(child as Element)) {
				if (inlineBuffer.trim()) {
					appendTextLines(inlineBuffer);
					inlineBuffer = '';
					pushSeparator();
				}
				handleBlock(child as Element);
				pushSeparator();
				continue;
			}
			inlineBuffer += textFromInline(child);
		}

		if (inlineBuffer.trim()) {
			appendTextLines(inlineBuffer);
		}
	};

	processChildrenAsBlocks(body);

	return collapseBlankLines(lines).join('\n').trim();
}

function isBlockElement(el: Element): boolean {
	return BLOCK_TAGS.has(el.tagName.toLowerCase());
}

function isListElement(el: Element): boolean {
	const tag = el.tagName.toLowerCase();
	return tag === 'ul' || tag === 'ol';
}

function textFromInline(node: Node): string {
	if (node.nodeType === 3) return node.textContent ?? '';
	if (node.nodeType !== 1) return '';

	const el = node as Element;
	const tag = el.tagName.toLowerCase();
	if (tag === 'br') return '\n';

	let out = '';
	for (const child of Array.from(el.childNodes)) out += textFromInline(child);
	return out;
}

function normalizeInline(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

function splitAndNormalize(text: string): string[] {
	return text
		.split('\n')
		.map((line) => line.replace(/\s+/g, ' ').trim())
		.filter(Boolean);
}

function collapseBlankLines(lines: string[]): string[] {
	const out: string[] = [];
	for (const line of lines) {
		if (line === '') {
			if (out.length === 0 || out[out.length - 1] === '') continue;
			out.push('');
			continue;
		}
		out.push(line);
	}
	return out;
}
