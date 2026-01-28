# DietWise Renderer

An internal component of [DietWise](https://dietwise.eu/), responsible for extracting HTML page content on behalf of the mobile app.

## Docker

Build with:

```bash
docker build -t dietwise-renderer .
```

Run (remove when finished):

```bash
docker run --rm -p 3000:3000 dietwise-renderer
```
