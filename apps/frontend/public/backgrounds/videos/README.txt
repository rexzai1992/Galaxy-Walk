Add your background mp4 files in this folder.

Then edit playlist.json:
{
  "videos": [
    "/backgrounds/videos/your-video-01.mp4",
    "/backgrounds/videos/your-video-02.mp4"
  ]
}

Behavior:
- Each video loops while active.
- Strict switch every 5 minutes.
- After last video, it cycles back to first.
- If a video fails, fallback JPG background remains visible.
