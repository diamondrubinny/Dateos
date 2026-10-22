// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  ConnectionState,
  type Participant,
  type LocalVideoTrack,
  type RemoteTrack,
  type RemoteVideoTrack,
  Room,
  RoomEvent,
  Track,
} from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type CallKeyPair, deriveCallKey, fromBase64Url, safetyCode } from './call-crypto';
import { createCallEncryption } from './call-encryption';
import { attachAudio, prepareCallMedia, releaseCallMedia } from './call-media';

export type CallRoomStatus = 'connecting' | 'waiting' | 'connected' | 'reconnecting' | 'ended';

export interface CallRoom {
  status: CallRoomStatus;
  micOn: boolean;
  cameraOn: boolean;
  remoteVideo: RemoteVideoTrack | undefined;
  localVideo: LocalVideoTrack | undefined;
  /** The browser blocked sound until the person taps (autoplay rules). */
  audioBlocked: boolean;
  /** Camera or microphone permission was refused. */
  permissionDenied: boolean;
  /** End-to-end encrypted with the other person's device (phase 16b). */
  secure: boolean;
  /** Four emoji both people see only if nobody swapped a key: compare them out loud. */
  safety: string[] | undefined;
  /** The other device sent no usable key: the call can't be private, so nothing is sent. */
  encryptionFailed: boolean;
  /** The LiveKit room while connected (for captions). */
  room: Room | null;
  toggleMic(): void;
  toggleCamera(): void;
  flipCamera(): void;
  startAudio(): void;
  leave(): Promise<void>;
}

export interface CallRoomInput {
  url: string;
  token: string;
  room: string;
  video: boolean;
  /** This device's key pair for this join; the secret half never leaves the device. */
  keyPair: CallKeyPair;
}

/**
 * One LiveKit room for one call, end-to-end encrypted. The microphone is published only once both
 * devices hold the same key (derived from each other's public key), so no frame ever leaves this
 * device unencrypted; the camera stays off until the person turns it on. Leaving (or the server
 * closing the room) ends it for good.
 */
export function useCallRoom(input: CallRoomInput | undefined) {
  const roomRef = useRef<Room | null>(null);
  const [status, setStatus] = useState<CallRoomStatus>('connecting');
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(false);
  const [remoteVideo, setRemoteVideo] = useState<RemoteVideoTrack>();
  const [localVideo, setLocalVideo] = useState<LocalVideoTrack>();
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [secure, setSecure] = useState(false);
  const [safety, setSafety] = useState<string[]>();
  const [encryptionFailed, setEncryptionFailed] = useState(false);
  const [current, setCurrent] = useState<Room | null>(null);
  const facing = useRef<'user' | 'environment'>('user');

  useEffect(() => {
    if (!input) return;
    let cancelled = false;
    const detachers: (() => void)[] = [];
    const encryption = createCallEncryption();
    const room = new Room({ adaptiveStream: true, dynacast: true, ...encryption.roomOptions });
    roomRef.current = room;
    setCurrent(room);
    let keyFor: string | undefined;
    let micPublished = false;

    /** Derives the key from the other device's public key (again if they rejoin with a new one). */
    const updateKey = async () => {
      const other = [...room.remoteParticipants.values()][0];
      const theirKey = other?.attributes.pk;
      if (!other || !theirKey || theirKey === keyFor) return;
      const theirs = fromBase64Url(theirKey);
      if (!theirs) {
        setEncryptionFailed(true);
        return;
      }
      keyFor = theirKey;
      await encryption.setKey(deriveCallKey(input.keyPair, theirs, input.room));
      setSafety(safetyCode(input.keyPair.publicKey, theirs));
      setSecure(true);
      if (micPublished || cancelled) return;
      micPublished = true;
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
      } catch {
        setMicOn(false);
        setPermissionDenied(true);
      }
    };
    const onPeer = (participant?: Participant) => {
      if (participant && participant.identity === room.localParticipant.identity) return;
      void updateKey();
    };

    const refreshRemote = () => {
      const other = [...room.remoteParticipants.values()][0];
      const publication = other?.getTrackPublication(Track.Source.Camera);
      const track =
        publication && !publication.isMuted ? (publication.track as RemoteVideoTrack) : undefined;
      setRemoteVideo(track);
      setStatus((s) => (s === 'ended' ? s : other ? 'connected' : 'waiting'));
    };
    room
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Audio) detachers.push(attachAudio(track));
        refreshRemote();
      })
      .on(RoomEvent.TrackUnsubscribed, refreshRemote)
      .on(RoomEvent.TrackMuted, refreshRemote)
      .on(RoomEvent.TrackUnmuted, refreshRemote)
      .on(RoomEvent.ParticipantConnected, (p) => {
        onPeer(p);
        refreshRemote();
      })
      .on(RoomEvent.ParticipantAttributesChanged, (_changed, p) => onPeer(p))
      .on(RoomEvent.ParticipantDisconnected, refreshRemote)
      .on(RoomEvent.AudioPlaybackStatusChanged, () => setAudioBlocked(!room.canPlaybackAudio))
      .on(RoomEvent.ConnectionStateChanged, (state) => {
        if (state === ConnectionState.Reconnecting) setStatus('reconnecting');
        if (state === ConnectionState.Connected) refreshRemote();
      })
      .on(RoomEvent.Disconnected, () => setStatus('ended'));

    void (async () => {
      try {
        await prepareCallMedia();
        await room.setE2EEEnabled(true);
        await room.connect(input.url, input.token, { autoSubscribe: true });
        if (cancelled) return;
        refreshRemote();
        setAudioBlocked(!room.canPlaybackAudio);
        await updateKey();
      } catch {
        if (!cancelled) setStatus('ended');
      }
    })();

    return () => {
      cancelled = true;
      detachers.forEach((d) => d());
      void room.disconnect().finally(() => encryption.dispose());
      void releaseCallMedia();
      roomRef.current = null;
      setCurrent(null);
    };
    // A new token means a new room; the same call keeps its connection.
  }, [input?.url, input?.token]);

  const toggleMic = useCallback(() => {
    const room = roomRef.current;
    if (!room || !secure) return;
    const next = !micOn;
    room.localParticipant
      .setMicrophoneEnabled(next)
      .then(() => setMicOn(next))
      .catch(() => setPermissionDenied(true));
  }, [micOn, secure]);

  const toggleCamera = useCallback(() => {
    const room = roomRef.current;
    // Nothing is published before the end-to-end key is in place.
    if (!room || !input?.video || !secure) return;
    const next = !cameraOn;
    room.localParticipant
      .setCameraEnabled(next, { facingMode: facing.current })
      .then((publication) => {
        setCameraOn(next);
        setLocalVideo(next ? (publication?.track as LocalVideoTrack | undefined) : undefined);
      })
      .catch(() => setPermissionDenied(true));
  }, [cameraOn, input?.video, secure]);

  const flipCamera = useCallback(() => {
    const track = localVideo;
    if (!track) return;
    facing.current = facing.current === 'user' ? 'environment' : 'user';
    void track.restartTrack({ facingMode: facing.current }).catch(() => undefined);
  }, [localVideo]);

  const startAudio = useCallback(() => {
    void roomRef.current
      ?.startAudio()
      .then(() => setAudioBlocked(false))
      .catch(() => undefined);
  }, []);

  const leave = useCallback(async () => {
    setStatus('ended');
    await roomRef.current?.disconnect();
  }, []);

  return {
    status,
    micOn,
    cameraOn,
    remoteVideo,
    localVideo,
    audioBlocked,
    permissionDenied,
    secure,
    safety,
    encryptionFailed,
    room: current,
    toggleMic,
    toggleCamera,
    flipCamera,
    startAudio,
    leave,
  } satisfies CallRoom;
}
