import {
  ConnectionState,
  type LocalVideoTrack,
  type RemoteTrack,
  type RemoteVideoTrack,
  Room,
  RoomEvent,
  Track,
} from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  toggleMic(): void;
  toggleCamera(): void;
  flipCamera(): void;
  startAudio(): void;
  leave(): Promise<void>;
}

/**
 * One LiveKit room for one call. Joins with the microphone on and the camera off: each person
 * decides when to be seen. Leaving (or the server closing the room) ends it for good.
 */
export function useCallRoom(input: { url: string; token: string; video: boolean } | undefined) {
  const roomRef = useRef<Room | null>(null);
  const [status, setStatus] = useState<CallRoomStatus>('connecting');
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(false);
  const [remoteVideo, setRemoteVideo] = useState<RemoteVideoTrack>();
  const [localVideo, setLocalVideo] = useState<LocalVideoTrack>();
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const facing = useRef<'user' | 'environment'>('user');

  useEffect(() => {
    if (!input) return;
    let cancelled = false;
    const detachers: (() => void)[] = [];
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;

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
      .on(RoomEvent.ParticipantConnected, refreshRemote)
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
        await room.connect(input.url, input.token, { autoSubscribe: true });
        if (cancelled) return;
        refreshRemote();
        setAudioBlocked(!room.canPlaybackAudio);
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
        } catch {
          setMicOn(false);
          setPermissionDenied(true);
        }
      } catch {
        if (!cancelled) setStatus('ended');
      }
    })();

    return () => {
      cancelled = true;
      detachers.forEach((d) => d());
      void room.disconnect();
      void releaseCallMedia();
      roomRef.current = null;
    };
    // A new token means a new room; the same call keeps its connection.
  }, [input?.url, input?.token]);

  const toggleMic = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;
    const next = !micOn;
    room.localParticipant
      .setMicrophoneEnabled(next)
      .then(() => setMicOn(next))
      .catch(() => setPermissionDenied(true));
  }, [micOn]);

  const toggleCamera = useCallback(() => {
    const room = roomRef.current;
    if (!room || !input?.video) return;
    const next = !cameraOn;
    room.localParticipant
      .setCameraEnabled(next, { facingMode: facing.current })
      .then((publication) => {
        setCameraOn(next);
        setLocalVideo(next ? (publication?.track as LocalVideoTrack | undefined) : undefined);
      })
      .catch(() => setPermissionDenied(true));
  }, [cameraOn, input?.video]);

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
    toggleMic,
    toggleCamera,
    flipCamera,
    startAudio,
    leave,
  } satisfies CallRoom;
}
