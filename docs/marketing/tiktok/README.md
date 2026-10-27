# TikTok video: "Hi, I'm Nexa"

| File                            | What                                                                    |
| ------------------------------- | ----------------------------------------------------------------------- |
| `nexaheart-tiktok-en.mp4`       | **English, with voice**: 26 s, 1080×1920; captions in `captions-en.srt` |
| `nexaheart-tiktok-he-music.mp4` | Hebrew, music only, ready for a recorded voice (below)                  |

**The English voice** is made on this machine with flite (`slt`), shaped into a brighter character
voice (+2 semitones, warm EQ, light room), and Nexa's mouth follows its real loudness frame by
frame (`source/voice-en.py`, `source/voice-en.json`). A local speech recogniser (Whisper) transcribes
every sentence correctly, music included; "NexaHeart" is heard as "Nexa-har" (the captions show it).
It's a synthetic voice: for a warmer, human one, record the same lines and replace the track.

`nexaheart-tiktok-he-music.mp4`: 26 seconds, vertical 1080×1920, Hebrew. **Nexa**, a friendly heart
character (blinking, waving, speaking), walks viewers through what makes NexaHeart different, with
big TikTok-style captions, real screens from the app (`docs/screenshots/he`) and an original
soundtrack generated in code (no licensing issues). The music is mixed low, leaving room for a voice.

## The voice-over

Nexa's mouth moves exactly during these lines; `voiceover-he.srt` has the same times. A warm,
friendly, smiling voice; light pace; about 2–4 seconds a line.

| Time        | Line                                        |
| ----------- | ------------------------------------------- |
| 0.3 – 2.3   | היי! אני נקסה                               |
| 2.6 – 5.9   | נמאס לשלם כדי לגלות מי עשה לכם לייק?        |
| 6.2 – 9.2   | ב־NexaHeart זה חינם. הכול. תמיד.            |
| 9.5 – 12.9  | בלי פרסומות, ובלי למכור את המידע שלכם.      |
| 13.2 – 17.0 | התאמות שמסבירות למה, וצ׳ק־אין בטיחות בדייט. |
| 17.3 – 20.7 | וכל קהילה יכולה להפעיל אפליקציה משלה.       |
| 21.0 – 24.0 | NexaHeart. היכרויות שמכבדות אותך.           |

**Adding it:** record the lines (a person, or a text-to-speech voice whose licence allows
advertising), save as `voice.wav`, then:

```sh
ffmpeg -i nexaheart-tiktok-he-music.mp4 -i voice.wav \
  -filter_complex "[0:a]volume=0.55[m];[m][1:a]amix=inputs=2:duration=first[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k nexaheart-tiktok-he.mp4
```

Or upload the video to TikTok as is and add the voice there.

## Rendering again

`source/tiktok.html` is the whole animation (every frame is a function of time); `source/render.mjs`
renders it frame by frame with Playwright and ffmpeg (fonts: `@fontsource/heebo`, OFL; screenshots
in `shots/`). Change the lines in `LINES` and the scenes in `seek()`.

⚖️ Before publishing: the "₪49.90 a month" paywall is a generic example of what other apps charge,
not a named competitor; check the claims against each community's terms and privacy policy, and
TikTok's advertising rules for dating apps (age targeting 18+) 📘.
