# audio/

Place your azan recording here as **`azan.mp3`**.

```
audio/azan.mp3
```

The page loads exactly that path (`index.html` → `<audio id="azanAudio" src="audio/azan.mp3">`).
Nothing else needs to change.

Notes:

- MP3 is what the markup expects. To use another format, update the `src` in `index.html`.
- Keep the file reasonably small (a 2–4 minute azan at 96–128 kbps is roughly 2–4 MB);
  GitHub Pages and most static hosts serve that fine, but anything above ~50 MB will be rejected by GitHub.
- If the file is missing, the page still works and shows a notice under **Tetapan azan**
  instead of failing silently.
