# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
# Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
"""Builds the English voice-over with flite (slt), shaped into a friendly character voice, and the
mouth envelope (one value per video frame) so the character's lips follow the real audio."""
import json, subprocess, wave, numpy as np
# (window start, window end, text shown, text spoken)
LINES = [
    (0.3, 2.4, 'Hi! I’m <span class="hl">Nexa</span>', "Hi! I'm Necksa."),
    (2.6, 6.0, 'Tired of paying just to see who liked you?', "Tired of paying, just to see, who likes you?"),
    (6.2, 9.3, 'On NexaHeart it’s <span class="hl">free</span>. Everything. Always.', "On Nexa Heart, it's free. Everything. Always."),
    (9.5, 13.0, 'No advertising. And we never sell your data.', "No advertising. And we never sell your data."),
    (13.2, 17.1, 'Your matches tell you <span class="hl">why</span>. And there\u2019s a safety check-in for dates.', "Your matches tell you why. And there is a safety check-in, for your dates."),
    (17.3, 20.8, 'And every community can run its <span class="hl">own</span> app.', "And every community can run its own app."),
    (21.0, 24.4, 'NexaHeart. Dating that respects you.', "Nexa Heart. Dating that respects you."),
]
SR = 44100
def sh(*a): subprocess.run(a, check=True, capture_output=True)
def dur(p): return float(subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',p],capture_output=True,text=True).stdout)
times = []
parts = []
for i, (a, b, shown, spoken) in enumerate(LINES):
    raw = f'voice-en/raw{i}.wav'; out = f'voice-en/line{i}.wav'
    text = spoken.replace("'", "’").replace(':', ' ')
    sh('ffmpeg','-y','-loglevel','error','-f','lavfi','-i',f"flite=text='{text}':voice=slt",raw)
    # +2 semitones (brighter, character-like), same pace; warm EQ, gentle compression, a touch of room.
    base = dur(raw); window = b - a
    tempo = max(1.0, min(1.25, (base * 0.97) / window))  # speed up only if it wouldn't fit
    f = (f"aresample={SR},asetrate={SR}*1.1225,aresample={SR},atempo={1/1.1225*tempo:.4f},"
         "highpass=f=110,lowpass=f=9000,equalizer=f=250:t=q:w=1:g=2,equalizer=f=3200:t=q:w=1.2:g=3,"
         "acompressor=threshold=-20dB:ratio=3:attack=5:release=80,aecho=0.8:0.6:40:0.12,volume=1.6")
    sh('ffmpeg','-y','-loglevel','error','-i',raw,'-af',f,'-ac','1','-ar',str(SR),out)
    d = dur(out)
    times.append([a, round(a + d, 3), shown])
    parts.append((a, out))
# Assemble on one 26 s track.
total = np.zeros(int(26 * SR), dtype=np.float32)
for a, p in parts:
    with wave.open(p) as w:
        x = np.frombuffer(w.readframes(w.getnframes()), dtype='<i2').astype(np.float32) / 32768
    s = int(a * SR); total[s:s+len(x)] += x[: len(total) - s]
total /= max(1e-6, np.max(np.abs(total))) / 0.9
with wave.open('voice-en.wav','wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((total*32767).astype('<i2').tobytes())
# Mouth envelope: RMS per video frame (30 fps), smoothed and normalised.
hop = SR // 30
rms = np.array([np.sqrt(np.mean(total[i*hop:(i+1)*hop]**2)) for i in range(len(total)//hop)])
rms = np.convolve(rms, [0.25,0.5,0.25], mode='same')
env = np.clip(rms / (np.percentile(rms[rms>0.01], 90) if np.any(rms>0.01) else 1), 0, 1)
json.dump({'lines': times, 'env': [round(float(v),3) for v in env]}, open('voice-en.json','w'), ensure_ascii=False)
for t in times: print(t[0], t[1], round(t[1]-t[0],2))
