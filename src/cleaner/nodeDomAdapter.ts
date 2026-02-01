import { parseHTML } from 'linkedom';
import type { HtmlToDocumentAdapter } from './HtmlToDocumentAdapter.js';

export const nodeDomAdapter: HtmlToDocumentAdapter = {
	parse(html: string): Document {
		const { document } = parseHTML(html);
		return document;
	},
};
