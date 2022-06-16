import * as Rtc from '../RTCHelper'
import * as SignalSocket from '../SignalSocketClient'
import { SEND_TYPE } from '../SignalSocketClient'

// TODO: need offer list

/*
    Configuration: 
        video: Boolean - video is enabled or disabled
*/

let configuration = {
    video: true
}

const SIGNAL_TYPE = 'call'

let requests = new Set() // [guid] - Existing handshake requests
let requested; // guid - Current requested peer
let accepted; // guid - Current accepted peer
let dataStream;
const hasRequest = (guid) => requests.has(guid)

let notifyRequest = () => {}
export const setNotifyRequest = callback => notifyRequest = callback

let handlerOnTrack = () => {}

export function init() {
    SignalSocket.setNotifySend(handlerSend)
    SignalSocket.setNotifySocket(handlerSocket)
}

export async function start(guid, onTrack) {
    if (!SignalSocket.connected()) return

    // Ensure accept a socket happens after accepting a receive request.
    SignalSocket.setNotifySend(handlerSend)
    SignalSocket.setNotifySocket(handlerSocket)
    handlerOnTrack = onTrack

    // Setup datastreams
    // navigator.mediaDevices.getUserMedia
    dataStream = await navigator.mediaDevices.getUserMedia({
	    audio: true
	    // video: true
	}) // TODO: video not necessary if disabled

    // This may be abstract-able but some data exchanges need more approval steps from the client (e.g. file name being sent)
    if (hasRequest(guid)) {
        accepted = guid
        SignalSocket.send(SEND_TYPE.RECEIVE, guid, {type: SIGNAL_TYPE, meta: configuration})
    } else {
        requested = guid
        SignalSocket.send(SEND_TYPE.SEND, guid, {type: SIGNAL_TYPE, meta: configuration})
    }
}

export function end() {
    requested = undefined
    accepted = undefined
    handlerOnTrack = () => {}

    // Close data streams
    if (dataStream) dataStream.getTracks().forEach(track => track.stop())
    dataStream = undefined

    Rtc.close()
}

/**
 * To handle receiving of a 'send' signal.
 */
function handlerSend(guid) {
    if (requested === guid) {
        // Both clients sent a "send" signal. Request socket connection from server.
        if (SignalSocket.getClientGuid() < requested) {
            // Rule: if both are requesters, the lower numeric GUID becomes receiver
            accepted = requested
            requested = undefined
            SignalSocket.send(SEND_TYPE.RECEIVE, guid, {type: SIGNAL_TYPE})
            return
        }
    }

    notifyRequest(guid)

    requests.add(guid) // Set prevents duplicates
}

/**
 * "requests" and "requested" context is specific to each Protocol. Handles reciving of
 * a "socket" signal. Should come after both clients agreed to call.
 */
function handlerSocket(msg) {
    // TODO: Can abstract below 4 lines
    if (accepted !== msg.source) {
        if (requested !== msg.target) {
            requests.add(msg.source)
            return
        }
    }


    // Sockets approved and received - start RTC setup
    Rtc.init(requested, peerConnection => {
        peerConnection.ontrack = handlerOnTrack // for UI to display incoming data

        if (requested) {
            Rtc.sendOffer()
        }

        // for receiver
        dataStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, dataStream)
        })
    })
}
