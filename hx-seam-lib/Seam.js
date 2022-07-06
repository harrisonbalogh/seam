/**
 * SEAM protocol file. Should be use with a relay server.
 * Handles RTC setup and handshake.
 *
 * Author: Harrison Balogh (First version: 2022)
 */
import { relay, isConnected as isRelayConnected  } from './RelayClient'
import * as RTCHelper from './RTCHelper'

/** Status callback states. */
export const STATUS = {
    Requested: "REQUESTED",
    Connected: "CONNECTED",
    Progress: "PROGRESS",
    Sent: "SENT",
    Rejected: "REJECTED",
    Accepted: "ACCEPTED",
    Error: "ERROR",
    ChatOpen: "CHAT_OPEN",
    ChatClosed: "CHAT_CLOSE",
    CallEnded: "CALL_ENDED",
    FileOpen: "FILE_OPEN"
}
export const CHANNEL_TYPE = {
    Chat: "CHAT",
    Call: "CALL",
    File: (fileName, size) => ["FILE",fileName,size].filter(Boolean).join('/')
}

/** Incoming peer connection-state requests. Map peer GUID to:
 *    hxDescriptor - Set() of enumerated readable channels in SDP.
 *    rtcDescriptor - RTCSessionDescription for remote RTC description setter.
 *    file/<name>/<size> - Data channel for offered file transfer.
 */
const requests = { /** {guid: {hxDescriptor: Set, rtcDescriptor: RTCSessionDescription}} */ }
/**
 * Sets requests[guid] to given data object, unless requests[guid] is already present, in which case
 * the provided data merges/overwrites with existing data.
 */
const addRequest = (guid, data) => {
    if (!hasRequest(guid)) requests[guid] = {}
    Object.assign(requests[guid], data)
}
/** Gets request by GUID and optionally a request checks if one exists with the given descriptor filter. */
export const hasRequest = (guid, descriptor) =>
    requests[guid] &&
    (descriptor === undefined || RTCHelper.eqSet(requests[guid].hxDescriptor, descriptor))
/** Gets first file request from GUID. File name and size are optional. */
export const getFileRequest = (guid, fileName, fileSize) => {
    if (requests[guid] === undefined) return
    for (let channel of requests[guid].hxDescriptor) {
        if (channel.includes(CHANNEL_TYPE.File(fileName, fileSize))) {
            return channel.split("/")
        }
    }
}
/** Maps RelayService GUIDs to Connection prototype objects */
const connections = { /** {guid: Connection prototype} */ }
/** Checks if the given connection type has been sent to a peer, by GUID. */
const hasConnection = (guid) => connections[guid] !== undefined
/** Returns existing connection by GUID if it exists, else a new Connection. */
const getConnection = (guid, statusCallback = () => {}) => {
    if (hasConnection(guid)) return connections[guid]
    connections[guid] = new Connection(guid, statusCallback)
    return connections[guid]
}
export const getPeers = () => Object.keys(connections).map(guid => connections[guid].public())
export const getPeer = guid => connections[guid] && connections[guid].public()
export const getOpenPeers = () => getPeers().filter(peer => peer.isChatOpen()) // TODO include all streams?

// TODO - implement "perfectNegotiation" design
/**
 * Sends RTC 'offer' to given peer by GUID unless the given peer has already requested
 * a connection. In which case an RTC 'answer' is sent immediately - accepting the peer offer.
 * @param {*} guid - Peer GUID to send or accept an offer to or from.
 * @param {*} statusCallback - Notifier for connection state changes.
 * @returns Exported Connection functions.
 */
 export async function connect(guid, statusCallback) {
    if (!isRelayConnected()) return statusCallback(STATUS.Error)

    let connection = getConnection(guid, statusCallback)
    connection.statusCallback = statusCallback
    connection.clearAcceptedChannels()

    await connection.chat.start()

    return connection.public()
}

/**
 * Connection prototype. Holds RTC object, peer client GUID.
*/
class Connection {
    constructor(guid, statusCallback = () => {}) {
        /// What channel types this connection has approved
        this.acceptedChannels = new Set()
        this.clearAcceptedChannels = () => this.acceptedChannels = new Set()

        /// WebRTC object with ICE callback suite setup
        this.rtc = RTCHelper.initRtc(this)
        /// RelayService-assigned identifier of peer
        this.guid = guid
        /// For Connection reference holders event reactions. See `Seam.STATUS`
        this.statusCallback = statusCallback

        this.chat = {
            channel: undefined,
            data: [],
            notifyMessage: () => {},
            start: async () => {
                this.acceptedChannels.add(CHANNEL_TYPE.Chat)
                // Check if connection request already exists
                if (hasRequest(this.guid, this.acceptedChannels)) {
                    await this.handleOffer(requests[guid].rtcDescriptor, requests[guid].hxDescriptor, this.guid)
                    delete requests[this.guid]
                } else {
                    if (this.chat.channel) this.chat.channel.close()
                    await this.chat.onDataChannel(this.rtc.createDataChannel(CHANNEL_TYPE.Chat))
                }
            },
            end: () => {
                if (this.chat.channel) this.chat.channel.close()
            },
            message: m => {
                if (m.trim() === "" || this.chat.channel === undefined) return
                this.chat.data.push({source: "self", message: m.trim()})
                this.chat.channel.send(m.trim())
            },
            onDataChannel: channel => {
                if (!this.acceptedChannels.has(channel.label) || channel.label !== CHANNEL_TYPE.Chat) return

                this.chat.channel = channel
                this.chat.channel.onopen = () => this.statusCallback(STATUS.ChatOpen)
                this.chat.channel.onclose = () => {
                    this.chat.channel = undefined
                    this.statusCallback(STATUS.ChatClosed)
                }
                this.chat.channel.onmessage = m => {
                    this.chat.data.push({source: this.guid, message: m.data})
                    this.chat.notifyMessage(m.data)
                }
            },
            isOpen: () => this.chat.channel && this.chat.channel.readyState === "open",
        }

        this.call = {
            streamRemote: undefined,
            streamLocal: undefined,
            start: async onCallTrack => {
                this.rtc.ontrack = track => {
                    this.call.streamRemote = track.streams[0]
                    onCallTrack(track.streams[0])
                    track.onended = () => {
                        this.statusCallback(STATUS.CallEnded)
                        this.call.end()
                    }
                    track.onmute = () => {} // TODO
                    track.onunmute = () => {} // TODO
                }
                this.acceptedChannels.add(CHANNEL_TYPE.Call)
                if (hasRequest(guid, this.acceptedChannels)) delete requests[guid]
                if (this.call.streamLocal) this.call.streamLocal.getTracks().forEach(track => track.stop())

                this.call.streamLocal = await navigator.mediaDevices.getUserMedia({
                    audio: true,
                    video: true
                })
                this.call.streamLocal.getTracks().forEach(track => {
                    this.rtc.addTrack(track, this.call.streamLocal)
                })
            },
            end: _ => {
                this.rtc.ontrack = () => {}
                this.acceptedChannels.delete(CHANNEL_TYPE.Call)
                if (this.call.streamLocal) this.call.streamLocal.getTracks().forEach(track => track.stop())
                this.call.streamLocal = undefined
                if (this.call.streamRemote) this.call.streamRemote.getTracks().forEach(track => track.stop())
                this.call.streamRemote = undefined
            },
            isOpen: () => this.call.streamRemote && this.call.streamRemote.getTracks().some(track => track.readyState === "live"),
        }

        this.file = {
            channel: undefined,
            data: undefined,
            reader: undefined,
            bytesRead: undefined,
            fileAccepted: undefined,
            readerHalt: false,
            SEND_FLAG: "send",
            offer: async (file) => {
                this.file.data = file

                this.file.channel = this.rtc.createDataChannel(CHANNEL_TYPE.File(file.name, file.size))
                this.file.channel.binaryType = 'arraybuffer'
                const BUFFER_THRESHOLD_LOW = 65535 // NYI
                const CHUNK_BYTE_SIZE = 16384
                const getFileChunk = offset => this.file.reader.readAsArrayBuffer(this.file.data.slice(offset, offset + CHUNK_BYTE_SIZE))
                this.file.reader = new FileReader()
                this.file.bytesRead = 0
                this.file.reader.addEventListener("error", () => {})
                this.file.reader.addEventListener("abort", () => {})
                this.file.reader.addEventListener("load", e => {
                    this.file.channel.send(e.target.result)
                    this.file.bytesRead += e.target.result.byteLength
                })
                this.file.channel.onmessage = m => {
                    if (m.data === this.file.SEND_FLAG) {
                        getFileChunk(this.file.bytesRead) // Bytes are only sent on-demand to give FS API time to write
                    }
                }
            },
            accept: async (name, size) => {
                let fileChannelName = CHANNEL_TYPE.File(name, size)
                this.acceptedChannels.add(fileChannelName)
                let fileRequest = getFileRequest(this.guid, name, size)
                if (fileRequest === undefined) return // TODO - File request not found
                let channel = requests[this.guid][`${fileChannelName}`]
                const handle = await window.showSaveFilePicker({suggestedName: name})
                this.file.fileAccepted = {name, size, buffer: 0, bufferBytes: 0, bytesReceived: 0, writable: await handle.createWritable()}
                this.file.onDataChannel(channel)
                delete requests[this.guid]
            },
            onDataChannel: channel => {
                if (channel.label.split("/")[0] !== CHANNEL_TYPE.File()) return

                if (!this.acceptedChannels.has(channel.label)) {
                    // This channel type has not been accepted but negotiation finished
                    let hxDescriptor = (requests[this.guid] && requests[this.guid].hxDescriptor) || new Set()
                    hxDescriptor.add(channel.label)
                    addRequest(this.guid, {hxDescriptor, [`${channel.label}`]: channel})
                    notifyRequest(this.guid, hxDescriptor)
                    return
                }

                // TODO this.channels.<file specific>
                this.file.channel = channel
                this.file.channel.onopen = () => this.statusCallback(STATUS.FileOpen)
                this.file.channel.onmessage = async m => {
                    await this.file.fileAccepted.writable.write({
                        type: "write",
                        position: this.file.fileAccepted.bytesReceived,
                        data: m.data
                    })
                    this.file.fileAccepted.bytesReceived += m.data.byteLength

                    if (this.file.fileAccepted.bytesReceived >= this.file.fileAccepted.size) {
                        await this.file.fileAccepted.writable.close()
                    } else {
                        this.file.channel.send(this.file.SEND_FLAG)
                    }
                }
                this.file.channel.send(this.file.SEND_FLAG)
            },
        }
    }

    /** Functions exposed to Connection reference holders */
    public() {
        return {
            setChatNotifyMessage: callback => this.chat.notifyMessage = callback,
            isChatOpen: () => this.chat.isOpen(),
            chatMessage: m => this.chat.message(m),
            chatData: () => this.chat.data,

            isCallOpen: () => this.call.isOpen(),
            callStart: callback => this.call.start(callback),
            callEnd: () => this.call.end(),

            fileOffer: file => this.file.offer(file),
            fileAccept: (name, size) => this.file.accept(name, size),

            acceptedChannels: () => this.acceptedChannels,
            guid: () => this.guid,
            close: () => this.close()
        }
    }

    /** Handle offer relay message. Add to request or auto-approve. */
    async handleOffer(rtcDescriptor, hxDescriptor) {
        // Check if this offer type is already approved
        if (RTCHelper.eqSet(this.acceptedChannels, hxDescriptor)) {
            await this.rtc.setRemoteDescription(new RTCSessionDescription(rtcDescriptor))
            await this.sendAnswer()

        // if (this.acceptedChannels.has(CHANNEL_TYPE.Chat) && RTCHelper.eqSet(hxDescriptor, new Set([CHANNEL_TYPE.Chat]))) {
        // TODO Connection downgrade? Notify? await this.sendAnswer()
        } else {
            addRequest(this.guid, {hxDescriptor, rtcDescriptor})
            notifyRequest(this.guid, hxDescriptor)
        }
    }

    /** Set remote descriptor with received answer packet. */
    handleAnswer(rtcDescriptor) {
        // TODO - verify hxDesciptor here?
        this.rtc.setRemoteDescription(new RTCSessionDescription(rtcDescriptor))
    }

    /** Add ICE candidates from received candidate packets. */
    handleCandidate(rtcDescriptor) {
        // TODO - verify hxDesciptor here?
        let candidate = undefined
        try {
            // TODO - review: it's possible for signal.candidate to be null? https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/addIceCandidate
            candidate = new RTCIceCandidate({
                candidate: rtcDescriptor.candidate.candidate,
                sdpMid: rtcDescriptor.id,
                sdpMLineIndex: rtcDescriptor.label
            }) // TODO - May just do new RTCIceCandidate(rtcDescriptor.candidate)
        } catch(err) {return}

        this.rtc.addIceCandidate(candidate)
    }

    /** Handle peer closing connection - perform close-down actions. */
    handleClosed() {
        this.close()
    }

    /** Create RTC offer packet and send to peer. */
    async sendOffer() {
        if (this.rtc.signalingState != "stable") return // Waits for next negotiation
        await this.rtc.setLocalDescription(await this.rtc.createOffer()) // RTCSessionDescription has type built in (answer/offer)
        this.send(this.rtc.localDescription)
        this.statusCallback(STATUS.Requested)
    }

    /** Create RTC answer packet and send to peer. */
    async sendAnswer() {
        await this.rtc.setLocalDescription(await this.rtc.createAnswer())
        this.send(this.rtc.localDescription) // RTCSessionDescription has type built in (answer)
        this.statusCallback(STATUS.Accepted)
    }

    /** Pass packet to peer through a RelayClient. */
    send(rtcDescriptor) {
        let data = {hxDescriptor: Array.from(this.acceptedChannels), rtcDescriptor}
        relay(this.guid, data)
    }

    /** Close down all RTC channels/tracks. */
    close() {
        this.call.end()
        this.chat.end()
        // TODO onremovetrack
        // TODO rtc.removetrack
        this.rtc.close()
        delete connections[this.guid]
        notifyClosed(this.guid)
    }
}

/**
 * Handle Relay server relay messages from peers. Should come from a RelayClient.
 * @param {{source: GUID, type: String, data: {*}}} message - From peer through relay server.
 */
export function handleRelay(message) {
    let peer = message.source
    let connection = getConnection(peer)

    const relayHandlers = {
        'offer': (a, b) => connection.handleOffer(a, b),
        'answer': a => connection.handleAnswer(a),
        'candidate': a => connection.handleCandidate(a),
        'closed': () => connection.handleClosed()
    }

    let handler = relayHandlers[message.data.rtcDescriptor.type]
    if (typeof handler !== 'function') return
    handler(message.data.rtcDescriptor, new Set(message.data.hxDescriptor))
}

let notifyRequest = guid => {}
/** Notifier for peer offer request. Called with the peer's GUID. */
export const setNotifyRequest = callback => notifyRequest = callback

let notifyClosed = guid => {}
/** Notifier for peer RTC connection closed. Called with the peer's GUID. */
export const setNotifyClosed = callback => notifyClosed = callback
