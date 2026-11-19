// EXPERIMENTAL video. Signaling uses BroadcastChannel, which only reaches other tabs of the same
// browser profile on the same device. There is no signaling server and no STUN/TURN configuration,
// so this cannot connect two different devices. It has not been verified end to end.
import { t } from './i18n.js';

let call = null;

export const inCall = () => Boolean(call);

/**
 * Join the same-browser demo call for a session.
 * opts: { sessionId, uid, partner, localVideo(), remoteVideo(), setStatus(text) }
 */
export async function joinVideo(opts) {
  if (call) return;
  const { sessionId, uid, partner, localVideo, remoteVideo, setStatus } = opts;
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection || !window.BroadcastChannel) {
    setStatus(t('vid.unsupported'));
    return;
  }
  const token = { stream: null, pc: null, channel: null, uid, partner };
  call = token;
  setStatus(t('vid.requesting'));
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    if (call !== token) { stream.getTracks().forEach(t => t.stop()); return; }
    token.stream = stream;
    if (localVideo()) localVideo().srcObject = stream;
    const pc = new RTCPeerConnection({ iceServers: [] });
    const channel = new BroadcastChannel('skillswap-video-' + sessionId);
    Object.assign(token, { pc, channel });
    let candidates = [];
    let offering = false;
    const send = x => channel.postMessage({ ...x, from: uid, to: partner });
    const offer = async () => {
      offering = true;
      await pc.setLocalDescription(await pc.createOffer());
      send({ description: pc.localDescription.toJSON() });
    };
    stream.getTracks().forEach(t => pc.addTrack(t, stream));
    pc.ontrack = e => { if (remoteVideo()) remoteVideo().srcObject = e.streams[0]; };
    pc.onicecandidate = e => { if (e.candidate) send({ candidate: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => {
      if (call !== token) return;
      setStatus(pc.connectionState === 'connected' ? t('vid.connected') : t('vid.status', { state: pc.connectionState }));
    };
    channel.onmessage = async ({ data: d }) => {
      if (d.to !== uid || d.from !== partner || call !== token) return;
      try {
        if (d.ready) {
          send({ present: true });
          if (uid < partner && !offering && pc.signalingState === 'stable' && !pc.localDescription) await offer();
        }
        if (d.present && uid < partner && !offering && !pc.localDescription) await offer();
        if (d.description) {
          await pc.setRemoteDescription(d.description);
          for (const c of candidates) await pc.addIceCandidate(c);
          candidates = [];
          if (d.description.type === 'offer') {
            await pc.setLocalDescription(await pc.createAnswer());
            send({ description: pc.localDescription.toJSON() });
          }
        }
        if (d.candidate) {
          if (pc.remoteDescription) await pc.addIceCandidate(d.candidate);
          else candidates.push(d.candidate);
        }
        if (d.left) {
          hangup();
          setStatus(t('vid.left'));
        }
      } catch {
        setStatus(t('vid.failed'));
      }
    };
    send({ ready: true });
    setStatus(t('vid.ready'));
  } catch (e) {
    hangup();
    setStatus(e.name === 'NotAllowedError' ? t('vid.denied') : t('vid.unavailable', { error: e.message }));
  }
}

/** Toggle audio or video tracks. Returns the new enabled state, or null when not in a call. */
export function toggleMedia(kind) {
  const tracks = call?.stream?.getTracks().filter(t => t.kind === kind) || [];
  if (!tracks.length) return null;
  const enabled = !tracks[0].enabled;
  tracks.forEach(t => { t.enabled = enabled; });
  return enabled;
}

export function hangup() {
  if (!call) return false;
  const c = call;
  call = null;
  try { c.channel?.postMessage({ from: c.uid, to: c.partner, left: true }); } catch { /* ignore */ }
  c.stream?.getTracks().forEach(t => t.stop());
  c.pc?.close();
  c.channel?.close();
  return true;
}
