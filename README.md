# DietWise Renderer

An internal component of [DietWise](https://dietwise.eu/), responsible for extracting HTML page content on behalf of the mobile app.

## Running

### Command line (development)

```bash
npm run dev
```

### Docker

Build with:

```bash
docker build -t dietwise-renderer .
```

Run (remove when finished):

```bash
docker run --rm -p 3000:3000 dietwise-renderer
```

## Testing

### Running with test data

1. Download the page source of recipes in a folder, name them 001.html, 002.html etc.
2. Define the environment variable `DW_RENDERER_TEST_DIR` to point to that folder
3. Run the dietwise-renderer; when the URL is like "123.html" (no scheme, server etc), it will read the corresponding file from the test folder

### Clean HTML CLI

Use the CLI to clean a downloaded HTML file and emit the `PageCleaningResult` JSON:

```bash
tsx scripts/clean-html-for-llm.ts ./page.html
```

Or via npm script:

```bash
npm run clean:html -- ./page.html
```

Options:

```plain
  --allowed-tags <list>                Comma-separated tag list or keyword: default, recipe-minimal
  --drop-media | --no-drop-media       Drop media elements (default: true)
  --strict-urls | --no-strict-urls     Keep only http/https (default: true)
  --keep-tables | --no-keep-tables     Preserve minimal table tags (default: false)
  --max-depth <number>                 Max nodes to process (default: 200000)
  --apply-consent-ui-heuristics | --no-apply-consent-ui-heuristics
                                       Try to remove consent UI (default: true)
```

The `DW_RENDERER_TEST_DIR` environment variable works here too.

### Download the HTML

Use this to create test files or check what would the renderer make out of a given URL. The utility `jq` is a prerequisite.
Make sure the server is running locally!

```bash
curl -s -X POST http://localhost:3000/render -d '{"url":"https://recipes.site/yummy","simplify":false}' -H "Content-Type: application/json" | jq -r .output > testdata/001.html
```
