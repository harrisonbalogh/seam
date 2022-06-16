import * as Rtc from '../RTCHelper'
import * as SignalSocket from '../SignalSocketClient'
// import { SEND_TYPE } from '../SignalSocketClient'

// TODO: need offer list

export const SIGNAL_ACTION = 'chat'

// let requests = new Set() // [guid] - Existing handshake requests
// let requested; // guid - Current requested peer
// let accepted; // guid - Current accepted peer
let dataChannel;
// const hasRequest = (guid) => requests.has(guid)

let notifyRequest = () => {}
export const setNotifyRequest = callback => notifyRequest = callback

let notifyMessage = () => {}
export const setNotifyMessage = callback => notifyMessage = callback

let notifyEnd = () => {}
export const setNotifyEnd = callback => notifyEnd = callback

let notifyStart = () => {}
export const setNotifyStart = callback => notifyStart = callback

// export function init() {
//     SignalSocket.setNotifySend(handlerSend)
//     SignalSocket.setNotifySocket(handlerSocket)
// }

export async function start(guid) {
    if (!SignalSocket.connected()) return

    // Ensure accept a socket happens after accepting a receive request.
    // SignalSocket.setNotifySend(handlerSend)
    // SignalSocket.setNotifySocket(handlerSocket)

    // This may be abstract-able but some data exchanges need more approval steps from the client (e.g. file name being sent)
    // if (hasRequest(guid)) {
    //     accepted = guid
    //     SignalSocket.send(SEND_TYPE.RECEIVE, guid, {type: SIGNAL_ACTION})
    // } else {
    //     requested = guid
    //     SignalSocket.send(SEND_TYPE.SEND, guid, {type: SIGNAL_ACTION})
    // }
}

export function send(msg) {
    if (!dataChannel) return

    dataChannel.send(msg)
}

export function end() {
    requested = undefined
    accepted = undefined
    dataChannel = undefined

    // TODO Close data streams

    Rtc.close()
}

/**
 * To handle receiving of a 'send' signal.
 */
function handlerSend(guid) {
    // if (requested === guid) {
    //     // Both clients sent a "send" signal. Request socket connection from server.
    //     if (SignalSocket.getClientGuid() < requested) {
    //         // Rule: if both are requesters, the lower numeric GUID becomes receiver
    //         accepted = requested
    //         requested = undefined
    //         SignalSocket.send(SEND_TYPE.RECEIVE, guid, {type: SIGNAL_ACTION})
    //         return
    //     }
        
    // }

    // notifyRequest(guid)

    // requests.add(guid) // Set prevents duplicates
}

/**
 * "requests" and "requested" context is specific to each Protocol. Handles reciving of
 * a "socket" signal. Should come after both clients agreed to call.
 */
function handlerSocket(msg) {
    // TODO: Can abstract below 4 lines
    // if (accepted !== msg.source) {
    //     if (requested !== msg.target) {
    //         requests.add(msg.source)
    //         return
    //     }
    // }

    // Sockets approved and received - start RTC setup
    Rtc.init(requested, peerConnection => {
        if (requested) {
            console.log(`RTC Requester.`)
            dataChannel = peerConnection.createDataChannel('chat')
            dataChannel.onmessage = event => notifyMessage(event.data)
            dataChannel.onopen = () => {notifyStart(msg.target)}
            dataChannel.onclose = notifyEnd

            Rtc.sendOffer()
        } else if (accepted) {
            peerConnection.ondatachannel = evt => {
                console.log(`RTC Receiver.`)
                dataChannel = evt.channel
                dataChannel.onmessage = event => notifyMessage(event.data)
                dataChannel.onopen = () => {notifyStart(msg.source)}
                dataChannel.onclose = notifyEnd
            }
        }
        
        // dataChannel.onopen = () => {

        // }
    })
}
