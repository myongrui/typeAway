# type-away

Just type and keep typing. This is a digital room for your thoughts and that room is infinitely big. Customize your experience with the icons in the top right and keep track of where you are on this possibly infinite page on the bottom left. Enjoy <3



## Sounds

The audio samples aren't in this repository — they're a typewriter recording and
keyboard clips cut from a sound-test video, so they stay local. The app degrades
gracefully: with no `audio/` directory, `thock`, `cream` and `typewriter` fall back
to the WebAudio synth in `app.js`.

To supply your own, drop files into `audio/`:

| sound | files |
| --- | --- |
| thock | `thock-1.wav` … `thock-12.wav` |
| cream | `cream-1.wav` … `cream-12.wav` |
| typewriter | `keypress.mp3`, `return.mp3` |

The MIT-licensed packs in [thock-soundpacks](https://github.com/kamillobinski/thock-soundpacks)
are a good source — each is a zip containing `1.wav`–`5.wav`, space and enter
variants, and a `config.json`.
