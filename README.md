# DietWise Renderer

An internal component of [DietWise](https://dietwise.eu/), responsible for extracting HTML page content on behalf of the mobile app.

## Running

### Command line (development)

```bash
npm install # only the first time and after every update
npm run dev
```

### Docker

Build with:

```bash
docker build -t dietwise-renderer .
```

Run (remove the container when finished; that's OK because the container is stateless):

```bash
docker run --rm -p 3000:3000 dietwise-renderer
```

## Testing

### The control file

Located under the folder `testdata/`, `_control.csv` contains the test data instructions.
Its columns are:

- The file name
- The URL to download
- Columns 3-end are texts to find in the output in order to be valid

This file is used both for downloading the test data (so that we do not hit the real servers all the time)
and for validating.

### Download the test data

The test data are real recipes from actual online sites.
They are probably the intellectual property of their authors.
That is why we do not store them permanently in this repo.
To work with them, we offer scripts for downloading them under `testdata/`:

1. Run the server, `npm run dev`
2. `cut -f1,2 testdata/_control.csv | while read f u; do if [ ! -f testdata/$f ]; then ./scripts/download.sh $u > testdata/$f; fi; done`

#### Downloading a single URL

```bash
./scripts/download.sh <URL>
```

### Running with test data

1. Download the page source of recipes in a folder, name them 001.html, 002.html etc.
2. Define the environment variable `DW_RENDERER_TEST_DIR` to point to that folder
3. Run the dietwise-renderer; when the URL is like "123.html" (no scheme, server etc), it will read the corresponding file from the test folder

Example:

```bash
DW_RENDERER_TEST_DIR=`pwd`/testdata npm run dev
```

#### Running with test data from VSCode

Create a launch configuration like the following:

```json
{
	"version": "0.2.0",
	"configurations": [

		{
			"type": "node",
			"request": "launch",
			"name": "dietwise-renderer",
			"program": "${workspaceFolder}/src/server.ts",
			"preLaunchTask": "npm: build",
			"outFiles": [
				"${workspaceFolder}/dist/**/*.(m|c|)js"
			],
			"env": {
				"DW_RENDERER_TEST_DIR": "${workspaceFolder}/testdata"
			}
		}
	]
}
```

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
  --output-minimal-text | --no-output-minimal-text
                                       Output minimal text, not HTML (default: false)
```

The `DW_RENDERER_TEST_DIR` environment variable works here too. Useful example:

```bash
tsx scripts/clean-html-for-llm.ts testdata/001.html --output-minimal-text                 # get the JSON output
tsx scripts/clean-html-for-llm.ts testdata/001.html --output-minimal-text | jq            # pretty-formatted JSON output
tsx scripts/clean-html-for-llm.ts testdata/001.html --output-minimal-text | jq -r .output # just the clean output
```

### Extract the JSON-LD data (if any) from a downloaded HTML

```bash
tsx scripts/extract-jsonld-recipes.ts testdata/001.html
```

### Validate the extraction

```bash
tsx scripts/validate-cleaning.ts
```
