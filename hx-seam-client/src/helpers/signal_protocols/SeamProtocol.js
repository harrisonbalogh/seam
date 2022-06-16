import * as ChatProtocol from './SeamProtocolChat'
import * as CallProtocol from './SeamProtocolCall'
import * as FileShareProtocol from './SeamProtocolFile'
import * as SignalServer from '../SignalSocketClient'
import { SEND_TYPE } from '../SignalSocketClient'

/**
 * List of protocols handled by SeamProtocol
 */
let Protocol = {
    'chat': ChatProtocol,
    'call': CallProtocol,
    'file': FileShareProtocol
}

/** Wrapper for SignalSocketClient.setNotifyAvailable(callback) */
export const setNotifyAvailable = SignalServer.setNotifyAvailable

/** Wrapper for SignalSocketClient.setNotifyExit(callback) */
export const setNotifyExit = SignalServer.setNotifyExit

/** Wrapper for SignalSocketClient.connect(onConnect) */
export function connect(onConnected) {
    SignalServer.setNotifySend(handlerRequest)
    SignalServer.setNotifySocket(handlerSocket)
    SignalServer.setNotifySocket(handlerCancel)
    SignalServer.setNotifySocket(handlerReject)
    SignalServer.connect(onConnected)
}

export const Chat = ChatProtocol
export const Call = CallProtocol
export const FileShare = FileShareProtocol

// let HANDLED_RECEIVABLES = {
//     'request': handlerRequest,
//     'cancel': handlerCancel,
// }

const handlerRequest = signal => Protocol[signal.protocol].handlerRequest(signal.target)
const handlerSocket = signal => Protocol[signal.protocol].handlerSocket(signal.target)
const handlerCancel = signal => Protocol[signal.protocol].handlerCancel(signal.target)
const handlerReject = signal => Protocol[signal.protocol].handlerReject(signal.target)

const PROTOCOL_PROTOTYPE = () => {
    let requests = new Set() // [guid] - Existing handshake requests
    let requested; // guid - Current requested peer
    let accepted; // guid - Current accepted peer
    const hasRequest = (guid) => requests.has(guid)

    const start = (guid) => {
        if (!SignalServer.connected()) return

        if (hasRequest(guid)) {
            accepted = guid
            SignalServer.send(SEND_TYPE.RECEIVE, guid, {type: SIGNAL_ACTION})
        } else {
            requested = guid
            SignalServer.send(SEND_TYPE.SEND, guid, {type: SIGNAL_ACTION})
        }
    }

    const handlerRequest = (guid) => {
        if (requested === guid) {
            // Both clients sent a "send" signal. Request socket connection from server.
            if (SignalServer.getClientGuid() < requested) {
                // Rule: if both are requesters, the lower numeric GUID becomes receiver
                accepted = requested
                requested = undefined
                SignalServer.send(SEND_TYPE.RECEIVE, guid, {type: SIGNAL_ACTION})
                return
            }
            
        }
    
        notifyRequest(guid)
    
        requests.add(guid) // Set prevents duplicates
    }

    const handlerSocket = (signal) => {
        if (accepted !== signal.source) {
            if (requested !== signal.target) {
                requests.add(signal.source)
                return
            }
        }

        // TODO Rtc.init
    }

    const handlerReject = (signal) => {
        // TODO
    }
    
    const handlerDeny = (signal) => {
        // TODO
    }
}
