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
    StableChat: "CHAT_STABLE"
}
const CONNECTION_STATE = {
    Accepted: "ACCEPTED",
    Requested: "REQUESTED",
    Unset: "UNSET"
}
const CONNECTION_STATE_DEFAULT = {
    chat: undefined,
    call: undefined,
    file: {}
}

export const CHANNEL_TYPE = {
    Chat: "CHAT",
    Call: "CALL",
    File: "FILE"
}

/** Incoming peer connection-state requests. Map peer GUID to:
 *    hxDescriptor - Set() of enumerated readable channels in SDP.
 *    rtcDescriptor - RTCSessionDescription for remote RTC description setter.
 */
export const requests = { /** {guid: {hxDescriptor: Set, rtcDescriptor: RTCSessionDescription}} */ }
export const hasRequest = (guid, descriptor) => requests[guid] && (descriptor === undefined || RTCHelper.eqSet(requests[guid].hxDescriptor, descriptor))
/** Outgoing client connection-state requests. Map peer GUID to:
 *    hxDescriptor - Set() of enumerated readable channels in SDP.
 *    rtcDescriptor - RTCSessionDescription for local RTC description setter.
 */
const requested = { /** {guid: {hxDescriptor: Set, rtcDescriptor: RTCSessionDescription}} */ }

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

/**
 * Connection prototype. Holds RTC object, client GUID.
*/
class Connection {
    constructor(guid, statusCallback = () => {}) {

        /// What channel types this connection has approved
        this.acceptedChannels = new Set()
        this.clearAcceptedChannels = () => this.acceptedChannels = new Set()

        /// Peer's latest protocol description offer (SDP)
        this.offer = undefined

        /// WebRTC object with ICE callback suite setup
        this.rtc = RTCHelper.initRtc(this)
        /// RelayService-assigned identifier
        this.guid = guid
        /// For Connection reference holders event reactions. See `Seam.STATUS`
        this.statusCallback = statusCallback

        this.messageHandler = {
            'offer': (a, b, c) => this.handleOffer(a, b, c),
            'answer': (a) => this.handleAnswer(a),
            'candidate': (a) => this.handleCandidate(a),
            'closed': () => this.handleClosed(),
            chatMessage: () => {},
            callTrack: () => {}
        }

        /** Functions exposed to Connection reference holders */
        this.export = {
            guid: () => this.guid,
            fileShare: _ => {},
            chatMessage: _ => {},
            acceptedChannels: () => this.acceptedChannels,
            callStart: async onCallTrack => {
                this.messageHandler.callTrack = onCallTrack
                this.acceptedChannels.add(CHANNEL_TYPE.Call)
                // Check if connection request already exists
                if (hasRequest(guid, this.acceptedChannels)) {
                    delete requests[guid]
                }
                await this.createChannel(CHANNEL_TYPE.Call)
            },
            callEnd: _ => {
                if (this.streams.call) this.streams.call.getTracks().forEach(track => track.stop())
            },
            setHandleChatMessage: callback => this.messageHandler.chatMessage = callback,
            isStable: _ => this.rtc.signalingState == "stable"
        }
        this.channels = {
            chat: undefined
        }
        this.streams = {
            call: undefined
        }
    }

    async createChannel(type = CHANNEL_TYPE.Chat) {
        if (type == CHANNEL_TYPE.Chat) {
            if (this.channels.chat) this.channels.chat.close()

            this.channels.chat = this.rtc.createDataChannel("chatChannel");
            this.channels.chat.onopen = () => this.statusCallback(STATUS.StableChat)
            this.channels.chat.onclose = () => {}
            this.channels.chat.onmessage = m => this.messageHandler.chatMessage(m.data);
            this.export.chatMessage = m => this.channels.chat.send(m)

            this.acceptedChannels.add(CHANNEL_TYPE.Chat)
        } else
        if (type == CHANNEL_TYPE.Call) {
            if (this.streams.call) this.streams.call.getTracks().forEach(track => track.stop())

            this.streams.call = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: true
            })

            this.streams.call.getTracks().forEach(track => {
                this.rtc.addTrack(track, this.streams.call)
            })
            this.rtc.ontrack = track => {
                this.messageHandler.callTrack(track.streams[0])
            }
            this.acceptedChannels.add(CHANNEL_TYPE.Call)
        }
    }

    async sendOffer() {
        const offer = await this.rtc.createOffer()
        if (this.rtc.signalingState != "stable") return // Waits for next negotiation
        await this.rtc.setLocalDescription(offer) // RTCSessionDescription has type built in (answer/offer)
        this.send(this.rtc.localDescription)
        this.statusCallback(STATUS.Requested)
    }

    async sendAnswer(descriptor) {
        if (this.acceptedChannels.has(CHANNEL_TYPE.Chat)) {
            this.rtc.ondatachannel = evt => {
                if (evt.channel.label != "chatChannel") return

                evt.channel.onopen = () => this.statusCallback(STATUS.StableChat)
                evt.channel.onclose = () => {}
                evt.channel.onmessage = m => this.messageHandler.chatMessage(m.data);
                this.export.chatMessage = m => evt.channel.send(m)
            }
        }
        if (this.acceptedChannels.has(CHANNEL_TYPE.Call)) {
            this.rtc.ontrack = track => {
                this.messageHandler.callTrack(track.streams[0])
            }
        }

        await this.rtc.setRemoteDescription(new RTCSessionDescription(descriptor))
        await this.rtc.setLocalDescription(await this.rtc.createAnswer())
        this.send(this.rtc.localDescription) // RTCSessionDescription has type built in (answer)
        this.statusCallback(STATUS.Accepted)
    }

    async handleOffer(rtcDescriptor, hxDescriptor, peer) {
        // Check if this offer type is already approved
        if (RTCHelper.eqSet(this.acceptedChannels, hxDescriptor)) {
            await this.sendAnswer(rtcDescriptor)
        } else {
            requests[peer] = {hxDescriptor, rtcDescriptor}
            notifyRequest(peer, hxDescriptor)
        }
    }

    handleAnswer(rtcDescriptor) {
        // TODO - verify hxDesciptor here?
        this.rtc.setRemoteDescription(new RTCSessionDescription(rtcDescriptor))

        return

        // For file receiver:
        this.rtc.ondatachannel = event => {
			dataChannel = event.channel;
			dataChannel.binaryType = "arraybuffer";

            dataChannel.onopen = () => {
                let fileReader = new FileReader();
                fileOffset = 0;
                fileStartTime = new Date();
                fileReader.addEventListener("error", err => console.error("Error reading file:", err));
                fileReader.addEventListener("abort", evt => console.log("File reading aborted:", evt));
                fileReader.addEventListener("load", async e => {
                    dataChannel.send(e.target.result);
                    let progress = `${roundTo(((fileOffset/fileSelected.size)*100), 2)}% sent.`
                    fileOffset += e.target.result.byteLength;
                    if (dataChannel.bufferedAmount < 65535) {
                        if (fileOffset < fileSelected.size) {
                            fileReader.readAsArrayBuffer(fileSelected.slice(fileOffset, fileOffset + 16384))
                        } else {
                            if (fileSelectedQueue.length > 0) {
                                fileOffset = 0;
                                let next = fileSelectedQueue[0];
                                fileSelectedQueue.splice(0,1);
                                setFileSelected(next);
                            }
                            console.log("File transfer completion time: " + ((new Date() - fileStartTime)/1000) + " seconds");

                        }
                    }
                });
                fileLabel.innerHTML = "Sending";
                fileReader.readAsArrayBuffer(fileSelected.slice(fileOffset, 16384))
            }

            dataChannel.onclose = () => {}
		};

        // For file requester:
        this.rtc.ondatachannel = event => {
			dataChannel = event.channel;
			dataChannel.binaryType = "arraybuffer";
            dataChannel.bufferedAmountLowThreshold = 65535;
            dataChannel.onbufferedamountlow = () => fileReader.readAsArrayBuffer(fileSelected.slice(fileOffset, fileOffset + 16384));
		};
        dataChannel.onmessage = function(event) {
            fileInboundBuffer.push(event.data);
            fileInboundSize += event.data.byteLength;

            // receiveProgress.value = receivedSize; clip: rect(0, 0, 38px, 0);
              let ratio = (fileInboundSize/fileReceiveSize);
              fileProgressReceive.style.clip = "rect(0, "+(280*ratio)+"px, 38px, 0)"
              fileInboundLabel.innerHTML = roundTo(ratio*100, 2)+"% received.";

            // we are assuming that our signaling protocol told
            // about the expected file size (and name, hash, etc).
            if (fileInboundSize === fileReceiveSize) {
              const received = new Blob(fileInboundBuffer);
              fileInboundBuffer = [];
                  fileInboundSize = 0;

                  actionContainers[ACTION_FILE].style.height = "38px";

                  let url = URL.createObjectURL(received);
                  let a = document.createElement("a");
                  a.style.display = "none";
                  document.body.appendChild(a);
                  a.href = url;
                  a.download = fileReceiveName;
                  fileReceiveName = "";
                  a.click();
                  URL.revokeObjectURL(url);
                  document.body.removeChild(a);

                  if (fileReceieveQueue == 0) {
                      console.log("Finished queue.");
                      dataChannel.close();
                  } else {
                      console.log("Awaiting next queue item...");
                      sendWebRTCSignal({type: "meta"});
                  }
            }

          }
    }

    handleCandidate(rtcDescriptor) {
        // TODO - verify hxDesciptor here?
        let candidate;
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

    handleClosed() {
        this.close()
    }

    send(rtcDescriptor) {
        let data = {hxDescriptor: Array.from(this.acceptedChannels), rtcDescriptor}
        relay(this.guid, data)
    }

    close() {
        this.rtc.getSenders().forEach(sender => this.rtc.removeTrack(sender))
        this.rtc.close()
        this.stateReset()
        notifyClosed(this.guid)
        delete connections[this.guid]
    }
}

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
    // Calling connect() will only happen on a fresh connection so reset back to Chat only
    connection.clearAcceptedChannels()
    connection.acceptedChannels.add(CHANNEL_TYPE.Chat)

    // Check if connection request already exists
    if (hasRequest(guid, connection.acceptedChannels)) {
        await connection.sendAnswer(requests[guid].rtcDescriptor)
        delete requests[guid]
    } else {
        await connection.createChannel(CHANNEL_TYPE.Chat)
    }

    return connection.export
}

/**
 * Handle Relay server relay messages from peers.
 * @param {{source: GUID, type: String, data: {*}}} message - From peer through relay server.
 */
export function handleRelay(message) {
    let peer = message.source
    let connection = getConnection(peer)

    let messageHandler = connection.messageHandler[message.data.rtcDescriptor.type]
    if (typeof messageHandler !== 'function') return

    messageHandler(message.data.rtcDescriptor, new Set(message.data.hxDescriptor), peer)
}

let notifyRequest = guid => {}
/** Notifier for peer offer request. Called with the peer's GUID. */
export const setNotifyRequest = callback => notifyRequest = callback

let notifyClosed = guid => {}
/** Notifier for peer RTC connection closed. Called with the peer's GUID. */
export const setNotifyClosed = callback => notifyClosed = callback
