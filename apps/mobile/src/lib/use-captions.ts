// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { type Room, RoomEvent } from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { installOnDeviceSpeech, onDeviceSpeechAvailable, startSpeech } from './speech';

/**
 * Live captions (phase 16c). Each device transcribes **its own** microphone, on the device, and
 * only while the other person asked for captions; the text travels inside the end-to-end encrypted
 * call and is never stored. A muted microphone means no captions either.
 */
const TOPIC = 'nexaheart.captions';
const MAX_TEXT = 500;

type Message =
  | { t: 'request'; on: boolean }
  | { t: 'state'; state: 'on' | 'off' | 'unavailable' }
  | { t: 'text'; text: string; final: boolean };

function parse(raw: string): Message | null {
  try {
    const m = JSON.parse(raw) as Record<string, unknown>;
    if (m.t === 'request' && typeof m.on === 'boolean') return { t: 'request', on: m.on };
    if (m.t === 'state' && (m.state === 'on' || m.state === 'off' || m.state === 'unavailable')) {
      return { t: 'state', state: m.state };
    }
    if (m.t === 'text' && typeof m.text === 'string' && typeof m.final === 'boolean') {
      return { t: 'text', text: m.text.slice(0, MAX_TEXT), final: m.final };
    }
  } catch {
    // not ours
  }
  return null;
}

export type TheirCaptions = 'idle' | 'waiting' | 'on' | 'unavailable';

export interface Captions {
  /** I asked to see the other person's words as text. */
  showing: boolean;
  their: TheirCaptions;
  /** Their last finished sentences (at most two) and the one in progress. */
  lines: string[];
  interim: string;
  /** The other person asked for captions and my words are being transcribed for them. */
  sending: boolean;
  /** They asked, but this device can't transcribe on the device. */
  cantSend: boolean;
  /** They asked, and this browser can download its on-device language pack once. */
  canInstall: boolean;
  install(): void;
  toggle(): void;
}

export function useCaptions(
  room: Room | null,
  options: { lang: string; micOn: boolean; secure: boolean },
): Captions {
  const [showing, setShowing] = useState(false);
  const [their, setTheir] = useState<TheirCaptions>('idle');
  const [lines, setLines] = useState<string[]>([]);
  const [interim, setInterim] = useState('');
  const [theyAsked, setTheyAsked] = useState(false);
  const [sending, setSending] = useState(false);
  const [cantSend, setCantSend] = useState(false);
  const [canInstall, setCanInstall] = useState(false);
  const [installed, setInstalled] = useState(0);
  const showingRef = useRef(showing);
  showingRef.current = showing;
  const sendRef = useRef<(message: Message) => void>(() => undefined);

  const send = useCallback(
    (message: Message) => {
      // Only inside the encrypted call, and only to the other person.
      if (!room || !options.secure) return;
      const other = [...room.remoteParticipants.values()][0];
      if (!other) return;
      void room.localParticipant
        .sendText(JSON.stringify(message), {
          topic: TOPIC,
          destinationIdentities: [other.identity],
        })
        .catch(() => undefined);
    },
    [room, options.secure],
  );
  sendRef.current = send;

  useEffect(() => {
    if (!room) return;
    room.registerTextStreamHandler(TOPIC, (reader) => {
      void reader.readAll().then((raw) => {
        const message = parse(raw);
        if (!message) return;
        if (message.t === 'request') setTheyAsked(message.on);
        else if (message.t === 'state') {
          if (!showingRef.current) return;
          setTheir(
            message.state === 'on'
              ? 'on'
              : message.state === 'unavailable'
                ? 'unavailable'
                : 'waiting',
          );
        } else if (showingRef.current) {
          if (message.final) {
            setLines((l) => [...l, message.text].slice(-2));
            setInterim('');
          } else setInterim(message.text);
        }
      });
    });
    // Someone who reconnects starts fresh: ask them again.
    const again = () => {
      if (showingRef.current) setTimeout(() => sendRef.current({ t: 'request', on: true }), 1000);
    };
    room.on(RoomEvent.ParticipantConnected, again);
    return () => {
      room.off(RoomEvent.ParticipantConnected, again);
      room.unregisterTextStreamHandler(TOPIC);
    };
  }, [room]);

  // Ask again once the call is encrypted, or when the other person reconnects.
  useEffect(() => {
    if (showing && options.secure) send({ t: 'request', on: true });
  }, [showing, options.secure, send]);

  // Transcribe my own microphone only while they asked, the call is encrypted and I'm not muted.
  useEffect(() => {
    if (!theyAsked || !options.secure) {
      setSending(false);
      setCantSend(false);
      setCanInstall(false);
      return;
    }
    if (!options.micOn) {
      setSending(false);
      send({ t: 'state', state: 'off' });
      return;
    }
    let stop: (() => void) | undefined;
    let cancelled = false;
    void onDeviceSpeechAvailable(options.lang).then((available) => {
      if (cancelled) return;
      if (available !== 'available') {
        setCanInstall(available === 'downloadable');
        setCantSend(available === 'unavailable');
        send({ t: 'state', state: 'unavailable' });
        return;
      }
      setCanInstall(false);
      setCantSend(false);
      setSending(true);
      send({ t: 'state', state: 'on' });
      stop = startSpeech(
        options.lang,
        (text, final) => send({ t: 'text', text: text.slice(0, MAX_TEXT), final }),
        () => {
          setSending(false);
          setCantSend(true);
          send({ t: 'state', state: 'unavailable' });
        },
      );
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [theyAsked, options.secure, options.micOn, options.lang, send, installed]);

  const install = useCallback(() => {
    void installOnDeviceSpeech(options.lang).then((ok) => {
      if (ok) setInstalled((n) => n + 1);
      else {
        setCanInstall(false);
        setCantSend(true);
      }
    });
  }, [options.lang]);

  const toggle = useCallback(() => {
    const next = !showingRef.current;
    setShowing(next);
    setTheir(next ? 'waiting' : 'idle');
    setLines([]);
    setInterim('');
    if (!next) send({ t: 'request', on: false });
  }, [send]);

  return { showing, their, lines, interim, sending, cantSend, canInstall, install, toggle };
}
