/** Adapter so this can parse HTML in browser or server. */
export interface HtmlToDocumentAdapter {
	parse(html: string): Document;
}
