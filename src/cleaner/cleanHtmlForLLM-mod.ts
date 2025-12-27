/* =========================================================
 * html-cleaner.unified.ts
 * Unified browser + server cleaner.
 * - No TreeWalker / NodeFilter / DOMParser hard dependency in the core.
 * - Works with any DOM that implements the standard Document/Element APIs
 *   (browser, jsdom, linkedom).
 * ========================================================= */

export interface CleanOptions {
	/** Allowed tags that will be preserved; all others are unwrapped (children kept). */
	allowedTags: Set<string>;
	/** Drop media elements upfront (img/video/audio/figure). Default true. */
	dropMedia: boolean;
	/** Keep only http/https links for <a href> and <img src>; allow relatives. */
	strictUrls: boolean;
	/** If true, preserve a minimal table set (table, thead, tbody, tr, th, td). */
	keepTables: boolean;
	/** Maximum number of element nodes to process to avoid pathological DOMs. */
	maxDepth: number;
}

export const DEFAULT_ALLOWED_TAGS: ReadonlySet<string> = new Set([
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
	'strong',
	'em',
	'b',
	'i',
	'u',
	'sup',
	'sub',
	'br',
	'time',
	'a',
]);

export const TABLE_TAGS = ['table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col'] as const;

export interface PageCleaningResult {
	html: string;
	textLength: number;
	stats: Record<string, number>;
}

/** Adapter so this can parse HTML in browser or server. */
export interface HtmlToDocumentAdapter {
	parse(html: string): Document;
}

/** Browser adapter using DOMParser (only used when you call cleanHtmlForLLM in browser). */
export const browserDomAdapter: HtmlToDocumentAdapter = {
	parse(html: string): Document {
		// DOMParser exists in browsers; in Node this will throw unless you polyfill.
		return new DOMParser().parseFromString(html, 'text/html');
	},
};

/**
 * Server usage recommendation:
 * - Parse using linkedom or jsdom and call cleanDocumentForLLM(doc, options)
 *   OR supply an adapter: { parse: (html) => document }
 *
 * Example (linkedom):
 *   import { parseHTML } from "linkedom";
 *   const adapter = { parse: (html:string) => parseHTML(html).document };
 *   cleanHtmlForLLM(html, opts, adapter);
 */
export function cleanHtmlForLLM(
	html: string,
	options?: Partial<CleanOptions>,
	adapter: HtmlToDocumentAdapter = browserDomAdapter,
): PageCleaningResult {
	const doc = adapter.parse(html);
	return cleanDocumentForLLM(doc, options);
}

export function cleanDocumentForLLM(doc: Document, options?: Partial<CleanOptions>): PageCleaningResult {
	const opts: CleanOptions = {
		allowedTags: new Set(DEFAULT_ALLOWED_TAGS),
		dropMedia: true,
		strictUrls: true,
		keepTables: false,
		maxDepth: 2000,
		...options,
	};
	if (opts.keepTables) TABLE_TAGS.forEach((t) => opts.allowedTags.add(t));

	const body = doc.body;
	const stats: Record<string, number> = {
		removedNodes: 0,
		unwrappedNodes: 0,
		removedAttrs: 0,
		strippedLinks: 0,
		emptyNodes: 0,
		removedComments: 0,
	};

	// Never unwrap these
	opts.allowedTags.add('html');
	opts.allowedTags.add('body');

	// 0) Remove comments (portable, no TreeWalker)
	stats.removedComments += removeComments(body);

	// 1) Drop obvious noise (selectors are fine across jsdom/linkedom/browsers)
	body.querySelectorAll(
		'script, style, noscript, template, iframe, frame, frameset, object, embed, form, input, textarea, select, button, svg, canvas, picture, source, meta, link, header, footer, nav, aside, share, ads, [aria-hidden="true"]',
	).forEach((n) => {
		n.remove();
		stats.removedNodes++;
	});

	if (opts.dropMedia) {
		body.querySelectorAll('img, video, audio, figure').forEach((n) => {
			n.remove();
			stats.removedNodes++;
		});
	} else {
		// Even if media kept, remove video/audio/figure unless explicitly allowed
		body.querySelectorAll('video, audio, figure').forEach((n) => {
			if (!opts.allowedTags.has(n.tagName.toLowerCase())) {
				n.remove();
				stats.removedNodes++;
			}
		});
	}

	// 2) Unwrap all non-whitelisted elements (keep children); add table separators if keepTables=false
	const unwrapIfNeeded = (el: Element): Node[] | null => {
		const tag = el.tagName.toLowerCase();

		// Never unwrap <html>/<body> or documentElement
		if (el === doc.documentElement || el === body) return null;
		if (opts.allowedTags.has(tag)) return null;

		const parent = el.parentNode;
		if (!parent) return null;

		// Add separators when removing table structure (so text doesn't glue)
		if (!opts.keepTables) {
			if (tag === 'tr') parent.insertBefore(doc.createTextNode('\n'), el.nextSibling);
			else if (tag === 'td' || tag === 'th') parent.insertBefore(doc.createTextNode(' '), el.nextSibling);
		}

		const moved: Node[] = [];
		while (el.firstChild) {
			const child = el.firstChild;
			moved.push(child);
			parent.insertBefore(child, el);
		}
		el.remove();
		stats.unwrappedNodes++;
		return moved;
	};

	// 3) BFS traversal with attribute stripping (portable nodeType numbers)
	// ELEMENT_NODE = 1
	const queue: Node[] = [body];
	let processed = 0;

	while (queue.length && processed++ < opts.maxDepth) {
		const node = queue.shift()!;
		if (!node || (node as any).nodeType !== 1) continue;

		const el = node as Element;
		const moved = unwrapIfNeeded(el);
		if (moved) {
			moved.forEach((ch) => queue.push(ch));
			continue;
		}

		const tag = el.tagName.toLowerCase();

		let keptHref = false;
		let keptSrc = false;

		for (const attr of Array.from(el.attributes)) {
			const name = attr.name.toLowerCase();

			if (tag === 'a' && name === 'href') {
				const safe = sanitizeUrl(attr.value, opts.strictUrls);
				if (safe) {
					el.setAttribute('href', safe);
					keptHref = true;
				} else {
					keptHref = false;
				}
				continue;
			}

			if (tag === 'img' && name === 'src') {
				// If img not allowed, remove it (per your rules)
				if (!opts.allowedTags.has('img')) {
					el.remove();
					stats.removedNodes++;
					break;
				}
				const safe = sanitizeUrl(attr.value, opts.strictUrls);
				if (safe) {
					el.setAttribute('src', safe);
					keptSrc = true;
				} else {
					keptSrc = false;
				}
				continue;
			}

			el.removeAttribute(name);
			stats.removedAttrs++;
		}

		// Post-attr enforcement
		if (tag === 'a' && !keptHref) {
			// If <a> has no href, remove it (unwrap text/children)
			const parent = el.parentNode;
			if (parent) {
				while (el.firstChild) parent.insertBefore(el.firstChild, el);
				el.remove();
				stats.strippedLinks++;
				continue;
			}
		}

		if (tag === 'img') {
			// If <img> isn't allowed or has no src, remove it.
			// (Also: if it was allowed but attributes got stripped, this catches it.)
			if (!opts.allowedTags.has('img') || !keptSrc) {
				el.remove();
				stats.removedNodes++;
				continue;
			}
		}

		// Queue children
		Array.from(el.childNodes).forEach((ch) => queue.push(ch));
	}

	// 4) Remove elements that are empty (no text) — except <img> with valid src
	const isMeaningful = (el: Element): boolean => {
		const tag = el.tagName.toLowerCase();
		if (tag === 'br') return true;
		if (tag === 'ul' || tag === 'ol') return el.querySelectorAll('li').length > 0;
		if (tag === 'img') return opts.allowedTags.has('img') && !!el.getAttribute('src');
		const txt = (el.textContent || '').replace(/[\u200B\u200C\u200D]/g, '').trim();
		return txt.length > 0;
	};

	// Portable post-order: collect all elements then traverse in reverse
	const allEls = collectElements(body, opts.maxDepth);
	for (let i = allEls.length - 1; i >= 0; i--) {
		const el = allEls[i];
		if (!opts.allowedTags.has(el.tagName.toLowerCase())) continue; // already unwrapped
		if (!isMeaningful(el)) {
			el.remove();
			stats.emptyNodes++;
		}
	}

	// 4b) Remove comments again (unwrapping can move comment nodes around)
	stats.removedComments += removeComments(body);

	// 5) Whitespace normalization
	// Convert <br> to newline tokens to help later collapse, then restore
	body.querySelectorAll('br').forEach((br) => br.replaceWith(doc.createTextNode('\n')));

	// Insert newlines around block-level tags so collapsing whitespace keeps structure
	const blockTags = [
		'p',
		'ul',
		'ol',
		'li',
		'h1',
		'h2',
		'h3',
		'h4',
		'h5',
		'h6',
		'table',
		'thead',
		'tbody',
		'tr',
		'th',
		'td',
		// NOTE: do NOT include div here; divs should have been unwrapped unless allowed.
	];
	for (const tag of blockTags) {
		body.querySelectorAll(tag).forEach((el) => {
			if (el.firstChild && (el.firstChild as any).nodeType !== 3 /* TEXT_NODE */) {
				el.insertBefore(doc.createTextNode('\n'), el.firstChild);
			}
			if (el.lastChild && (el.lastChild as any).nodeType !== 3 /* TEXT_NODE */) {
				el.appendChild(doc.createTextNode('\n'));
			}
		});
	}

	// Serialize and collapse whitespace globally
	let out = body.innerHTML
		.replace(/\n\s*/g, '\n')
		.replace(/[\t\r ]+/g, ' ')
		.replace(/\n{2,}/g, '\n')
		.trim();

	// Restore <br>
	out = out.replace(/\n/g, '<br>');

	// 6) Final pass: remove accidental empties again
	out = out
		.replace(/<(ul|ol)>\s*<\/(ul|ol)>/g, '')
		.replace(/<li>\s*<\/li>/g, '')
		.replace(/<p>\s*<\/p>/g, '')
		.replace(/<h[1-6]>\s*<\/h[1-6]>/g, '');

	// Cosmetic: ensure list items are on their own lines
	out = out.replace(/<li>/g, '\n<li>').trim();

	return { html: out, textLength: textLength(out), stats };
}

// ---------------- helpers ----------------

function sanitizeUrl(raw: string, strict: boolean): string | null {
	const val = (raw || '').trim();
	try {
		const u = new URL(val, 'https://example.invalid');
		const scheme = u.protocol.replace(':', '');

		// allow relatives by stripping the fake origin
		const normalized = u.href.replace('https://example.invalid', '');

		if (!strict) return normalized;

		if (scheme === 'http' || scheme === 'https') return normalized;

		// allow relative
		if (u.origin === 'https://example.invalid') return normalized;

		return null;
	} catch {
		// Bare relatives
		if (!strict && /^\/?[\w#/?=&.+%-]+$/.test(val)) return val;
		if (/^\/?[\w#/?=&.+%-]+$/.test(val)) return val;
		return null;
	}
}

function textLength(html: string): number {
	return html
		.replace(/<[^>]+>/g, '')
		.replace(/[\s\u200B\u200C\u200D]+/g, ' ')
		.trim().length;
}

/** Collect elements in document order, portable (no TreeWalker). */
function collectElements(root: Element, max: number): Element[] {
	const out: Element[] = [];
	const stack: Element[] = [root];
	let seen = 0;

	while (stack.length && seen++ < max) {
		const el = stack.pop()!;
		out.push(el);

		// push children in reverse so traversal stays roughly document-order
		const children = Array.from(el.children) as Element[];
		for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
	}
	return out;
}

/** Remove comment nodes under a root, portable (nodeType 8). */
function removeComments(root: Element): number {
	const toRemove: Comment[] = [];
	const stack: Node[] = [root];

	while (stack.length) {
		const node = stack.pop()!;
		if (!node) continue;

		const nt = (node as any).nodeType;
		if (nt === 8) {
			toRemove.push(node as Comment);
			continue;
		}

		// Only descend if it can have children
		const children = (node as any).childNodes ? Array.from((node as any).childNodes as NodeListOf<ChildNode>) : [];
		for (let i = children.length - 1; i >= 0; i--) stack.push(children[i] as unknown as Node);
	}

	for (const c of toRemove) c.parentNode?.removeChild(c);
	return toRemove.length;
}

// Convenience: minimal whitelist tailored for recipe pages
export const RECIPE_MINIMAL_TAGS = new Set<string>([
	'h1',
	'h2',
	'h3',
	'p',
	'ul',
	'ol',
	'li',
	'a',
	'strong',
	'em',
	'br',
	'time',
]);

export function cleanHtmlMinimal(html: string, adapter?: HtmlToDocumentAdapter): PageCleaningResult {
	return cleanHtmlForLLM(
		html,
		{
			allowedTags: new Set(RECIPE_MINIMAL_TAGS),
			keepTables: false,
			dropMedia: true,
		},
		adapter ?? browserDomAdapter,
	);
}
