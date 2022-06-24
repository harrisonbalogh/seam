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
    Error: "ERROR",
    StableChat: "CHAT_STABLE"
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
    return requests[guid] && requests[guid]
}
/** Checks if the given connection type has been sent to a peer, by GUID. */
export const hasRequested = (guid, type) => {
    return connections[guid] && requested[guid]
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
            if (this.rtc.signalingState != "stable" || !event.candidate) return
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
        this.rtc.onicegatheringstatechange = _ => {
            // Notify?
        }
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
            'closed': () => this.handleClosed(),
            'chatMessage': () => {}
        }
        this.export = {
            guid: () => this.guid,
            fileShare: _ => {},
            chatMessage: _ => {},
            callStart: _ => {},
            callEnd: _ => {},
            setHandleChatMessage: callback => this.messageHandler['chatMessage'] = callback
        }
    }

    async sendOffer() {
        // Create chat by default. For requesting peer
        let chatChannel = this.rtc.createDataChannel("chatChannel");
        chatChannel.onopen = () => this.statusCallback(STATUS.StableChat)
        chatChannel.onclose = () => {}
        chatChannel.onmessage = m => this.messageHandler['chatMessage'](m.data);
        this.export.chatMessage = m => chatChannel.send(m)

        await this.rtc.setLocalDescription(await this.rtc.createOffer())
        this.statusCallback(STATUS.Requested)
        this.send(this.rtc.localDescription) // RTCSessionDescription has type built in (answer/offer)
    }

    async sendAnswer(data) {
        // Setup chat by default. For receiving peer
        this.rtc.ondatachannel = evt => {
            evt.channel.onmessage = m => this.messageHandler['chatMessage'](m.data);
            this.export.chatMessage = m => evt.channel.send(m)
            evt.channel.onopen = this.statusCallback(STATUS.StableChat)
            evt.channel.onclose = () => {}
        }

        await this.rtc.setRemoteDescription(new RTCSessionDescription(data))
        await this.rtc.setLocalDescription(await this.rtc.createAnswer())
        this.send(this.rtc.localDescription) // RTCSessionDescription has type built in (answer)
        this.statusCallback(STATUS.Accepted)
    }

    async handleOffer(data) {
        if (hasRequested(data.source)) {
            delete requested[data.source]
        } else {
            requests[data.source] = data
            notifyRequest(data.source)
            return
        }

        await this.sendAnswer(data)
    }

    handleAnswer(data) {
        this.rtc.setRemoteDescription(new RTCSessionDescription(data))

        return

        // For call receiver:
        peerConnection.ontrack = track => {
            // htmlVideoDisplay.srcObject = track.streams[0]
        }

        // For call requester (and receiver?):
        // dataStream = await navigator.mediaDevices.getUserMedia({
        //     audio: true,
        //     video: true
        // })
        dataStream.getTracks().forEach(track => {
            this.rtc.addTrack(track, dataStream)
        })
        // Stop tracks:
        // dataStream.getTracks().forEach(track => track.stop())

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

    handleCandidate(data) {
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
    if (!hasConnection(guid)) connections[guid] = new Connection(guid, statusCallback)

    // TODO - hasRequest system to be replaced with "perfectNegotiation" design
    if (hasRequest(guid)) {
        let offer = requests[guid]
        delete requests[guid]
        connections[guid].statusCallback = statusCallback
        await connections[guid].sendAnswer(offer)
    } else {
        requested[guid] = new Set("chat") // TODO: enumerate // Push to requested
        await connections[guid].sendOffer()
    }
    return connections[guid].export
}

/**
 * Handle Relay server relay messages from peers.
 * @param {{source: GUID, type: String, data: {*}}} message - From peer through relay server.
 */
export function handleRelay(message) {
    let target = message.source
    if (!hasConnection(target)) {
        connections[target] = new Connection(target)
    }
    message.type = message.data.type
    let messageHandler = connections[target].messageHandler[message.type]
    if (typeof messageHandler !== 'function') {
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
