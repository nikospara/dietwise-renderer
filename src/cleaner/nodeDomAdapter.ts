import { parseHTML } from 'linkedom';
import type { HtmlToDocumentAdapter } from './cleanHtmlForLLM.js';

export const nodeDomAdapter: HtmlToDocumentAdapter = {
	parse(html: string): Document {
		const { document } = parseHTML(html);
		return document;
	},
};
