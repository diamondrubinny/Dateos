# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
# Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
"""Builds the English voice-over with flite (slt), shaped into a friendly character voice, and the
mouth envelope (one value per video frame) so the character's lips follow the real audio."""
import json, subprocess, wave, numpy as np
# (window start, window end, text shown, text spoken)
LINES = [
    (0.3, 2.4, 'Hi! I’m <span class="hl">Nexa</span>', "Hi! I'm Necksa."),
    (2.6, 6.0, 'Tired of paying just to find out who likes you?', "Tired of paying, just to find out who likes you?"),
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
    # Warm: a touch lower (-0.5 semitone) and slower, more body at 150-400 Hz, softer 3-7 kHz, a
    # subtle doubling (chorus) and a small warm room. Sped up only if a line wouldn't fit its slot.
    base = dur(raw); window = b - a
    pitch = 0.9715  # -0.5 semitone
    slow = 0.95
    tempo = max(slow, min(1.15, (base / pitch / slow * 0.97) / window * slow))
    f = (f"aresample={SR},asetrate={SR}*{pitch},aresample={SR},atempo={1/pitch*tempo:.4f},"
         "highpass=f=85,equalizer=f=170:t=q:w=0.9:g=4,equalizer=f=380:t=q:w=1:g=2.5,"
         "equalizer=f=1800:t=q:w=1:g=2.5,equalizer=f=3000:t=q:w=1.2:g=-1.5,equalizer=f=6500:t=q:w=1:g=-3,lowpass=f=8500,"
         "chorus=0.8:0.9:45:0.15:0.25:1.8,"
         "acompressor=threshold=-22dB:ratio=2.5:attack=10:release=150,"
         "aecho=0.85:0.7:55|110:0.16|0.08,volume=1.5")
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
