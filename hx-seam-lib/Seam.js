/**
 * SEAM protocol file. Should be use with a relay server.
 * Handles RTC setup and handshake.
 *
 * Author: Harrison Balogh (First version: 2022)
 */
import { relay, isConnected as isRelayConnected  } from './RelayClient'
import { STUN_SERVER_URL } from './Constants'

/** ICE configuration. Alternative: 'stun:stun.sipgate.net:3478' */
const ICE_CONFIGURATION = {iceServers: [{urls: STUN_SERVER_URL}]}

/** Status callback states. */
export const STATUS = {
    Requested: "REQUESTED",
    Connected: "CONNECTED",
    Progress: "PROGRESS",
    Sent: "SENT",
    Rejected: "REJECTED",
    Accepted: "ACCEPTED",
    Error: "ERROR"
}

/** {guid: Set} - Existing requests to peers */
const requests = {}
/** {guid: Set} - Existing requests from peers */
const requested = {}
/** // {guid: Connection prototype} */
const connections = {}

/**
 * Checks if the given peer, by GUID, has requested the given connection type.
 * @param {*} guid - Peer GUID assigned by Relay service.
 * @param {*} type - Optional. Omit to check for any request type.
 * @returns True if request from given GUID is active.
 */
export const hasRequest = (guid, type) => {
    return requests[guid] && (type === undefined || requests[guid].has(type))
}
/** Checks if the given connection type has been sent to a peer, by GUID. */
export const hasRequested = (guid, type) => {
    return connections[guid] && (type === undefined || connections[guid].actions[type] !== undefined)
}
/** Checks if the given connection type has been sent to a peer, by GUID. */
export const hasConnection = (guid) => {
    return connections[guid]
}

/**
 * Connection prototype. Holds RTC object, client GUID, and various
 * RTC helper fuinctions.
*/
class Connection {
    constructor(guid, statusCallback = () => {}) {
        this.rtc = new RTCPeerConnection(ICE_CONFIGURATION)
        this.rtc.onicecandidate = (event) => {
            if (!event.candidate) return
            // TODO: Check if label and id need to be read from sending client
            relay(guid, {
                type: 'candidate',
                label: event.candidate.sdpMLineIndex,
                id: event.candidate.sdpMid,
                candidate: event.candidate
            })
        }
        this.rtc.oniceconnectionstatechange = _ => {
            switch(this.rtc.iceConnectionState) {
                case "closed":
                case "failed":
                case "disconnected":
                  this.close()
                  break
              }
        }
        this.rtc.onicegatheringstatechange = _ => {} // Notify?
        this.rtc.onsignalingstatechange = () => {
            switch(this.rtc.signalingState) {
                case "closed":
                  this.close()
                  break
              }
        }
        this.rtc.onnegotiationneeded = async () => {
            const offer = await this.rtc.createOffer()
            if (this.rtc.signalingState != "stable") return // Waits for next negotiation
            await this.rtc.setLocalDescription(offer)
            this.send(this.rtc.localDescription)
        }

        this.guid = guid
        this.statusCallback = statusCallback
        this.messageHandler = {
            'offer': (d) => this.handleOffer(d),
            'answer': (d) => this.handleAnswer(d),
            'candidate': (d) => this.handleCandidate(d),
            'closed': () => this.handleClosed()
        }
        this.export = {
            guid: function() {return this.guid},
            fileShare: _ => {},
            chatMessage: _ => {},
            callStart: _ => {},
            callEnd: _ => {}
        }
    }

    async handleOffer(data) {
        if (hasRequested(data.source)) {
            delete requested[data.source]
        } else {
            requests[data.source] = new Set("something")
            notifyRequest(data.source)
        }
        await this.rtc.setRemoteDescription(new RTCSessionDescription(data))
        await this.rtc.setLocalDescription(await this.rtc.createAnswer())
        console.log(`Offer from ${data.source}`)
        this.send(this.rtc.localDescription) // RTCSessionDescription has type built in (answer)
    }

    handleAnswer(data) {
        this.rtc.setRemoteDescription(new RTCSessionDescription(data))
        console.log(`Answer from ${data.source}`)
    }

    handleCandidate(data) {
        console.log(`Candidate from ${data.source}`)
        let candidate;
        try {
            // TODO - review: it's possible for signal.candidate to be null? https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/addIceCandidate
            candidate = new RTCIceCandidate({
                candidate: data.candidate.candidate,
                sdpMid: data.id,
                sdpMLineIndex: data.label
            }) // TODO - May just do new RTCIceCandidate(data.candidate)
        } catch(err) {return}

        this.rtc.addIceCandidate(candidate)
    }

    handleClosed() {
        this.close()
    }

    send(data) {
        relay(this.guid, data)
    }

    close() {
        this.rtc.getSenders().forEach(sender => this.rtc.removeTrack(sender))
        this.rtc.close()
        notifyClosed(this.guid)
        delete connections[this.guid]
    }
}

/**
 * Sends RTC 'offer' to given peer by GUID unless the given peer has already requested
 * a connection. In which case an RTC 'answer' is sent immediately - accepting the peer offer.
 * @param {*} guid - Peer GUID to send or accept an offer to or from.
 * @param {*} statusCallback - Notifier for connection state changes.
 * @returns Exported Connection functions.
 */
export async function connect(guid, statusCallback) {
    if (!isRelayConnected()) return statusCallback(STATUS.Error)

    if (hasRequest(guid) && hasConnection(guid)) {
        delete requests[guid] // Pop from requests
        let peerConnection = connections[guid].rtc
        connections[guid].statusCallback = statusCallback
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data))
        await peerConnection.setLocalDescription(await peerConnection.createAnswer())
        statusCallback(STATUS.Accepted)
    } else {
        let connection = new Connection(guid, statusCallback)
        let peerConnection = connection.rtc
        connections[guid] = connection // Map this peer GUID to this connection
        requested[guid] = new Set("call") // TODO: enumerate // Push to requested
        await peerConnection.setLocalDescription(await peerConnection.createOffer())
        statusCallback(STATUS.Requested)
    }

    connections[guid].send(connections[guid].rtc.localDescription) // RTCSessionDescription has type built in (answer/offer)
    return connections[guid].export
}

/**
 * Handle Relay server relay messages from peers.
 * @param {{source: GUID, type: String, data: {*}}} message - From peer through relay server.
 */
export function handleRelay(message) {
    console.log(`New Message.`)
    console.log(message)
    let target = message.source
    if (!hasConnection(target)) {
        connections[target] = new Connection(target)
    }
    message.type = message.data.type
    let messageHandler = connections[target].messageHandler[message.type]
    if (typeof messageHandler !== 'function') {
        console.log(`Ignoring unhandled peer message of type: ${message.type}`)
        return
    }
    message.data.source = message.source
    messageHandler(message.data)
}

let notifyRequest = guid => {}
/** Notifier for peer offer request. Called with the peer's GUID. */
export const setNotifyRequest = callback => notifyRequest = callback

let notifyClosed = guid => {}
/** Notifier for peer RTC connection closed. Called with the peer's GUID. */
export const setNotifyClosed = callback => notifyClosed = callback
