import { STUN_SERVER_URL } from './Constants'

/** ICE configuration. Alternative: 'stun:stun.sipgate.net:3478' */
const ICE_CONFIGURATION = {iceServers: [{urls: STUN_SERVER_URL}]}

export function initRtc(connection) {
  let rtc = new RTCPeerConnection(ICE_CONFIGURATION)

  rtc.onicecandidate = (event) => {
    if (rtc.signalingState != "stable" || !event.candidate) return
    // TODO: Check if label and id need to be read from sending client
    connection.send({
        type: 'candidate',
        label: event.candidate.sdpMLineIndex,
        id: event.candidate.sdpMid,
        candidate: event.candidate
    })
  }
  rtc.oniceconnectionstatechange = _ => {
      switch(rtc.iceConnectionState) {
          case "closed":
          case "failed":
          case "disconnected":
            connection.close()
            break
        }
  }
  rtc.onicegatheringstatechange = _ => {}
  rtc.onsignalingstatechange = () => {
      switch(rtc.signalingState) {
          case "closed":
            connection.close()
            break
        }
  }
  rtc.onnegotiationneeded = async () => {
      connection.sendOffer()
  }

  return rtc
}

/** Set equality checker */
export function eqSet(as, bs) {
  if (as.size !== bs.size) return false;
  for (var a of as) if (!bs.has(a)) return false;
  return true;
}
