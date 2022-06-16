import * as RelayClient from './RelayClient'
import * as Call from './signal_protocols/ProtocolCall'
// import * as Chat from './signal_protocols/ProtocolChat'
// import * as FileShare from './signal_protocols/ProtocolFile'
import { STATUS as CONNECTION_STATUS } from './signal_protocols/Seam'
import * as Seam from './signal_protocols/Seam'

// launch app - assumes RelayClient not open

let availablePeers = [] // guids

RelayClient.setHandleRelay(Seam.handleRelay)
RelayClient.setNotifyAvailable((guid) => {
    // Add GUID to peer list
    availablePeers.push(guid)
})
RelayClient.connect((guid) => {
    // Show your GUID, update connected visuals
})

Seam.setNotifyRequest(peer => {
    // Show request notification on peer in availablePeers
})
Seam.setNotifyClosed(peer => {
    // Close RTC screen.
    // Remove request notifications.
})

let connections = []
let seamConnectionA = Seam.connect(availablePeers[0], status => {
    if (status == CONNECTION_STATUS.Requested) {
        // Update UI with spinner
    } else if (status == CONNECTION_STATUS.Accepted) {
        // Update UI connection chat
    }
})
connections.push(seamConnectionA)

connections[0].fileShare(status => {
    if (status == "STARTED") {
        // update UI
    } else if (status == "PROGRESS") {
        // update UI
    }
})
connections[0].chatMessage("hey", status => {
    if (status == "SENT") {
        // update UI
    }
})
connections[0].callStart(track => {
    // check if the video display is open?

    // when a track is coming through
    htmlVideoDisplay.srcObject = track.streams[0] // Attach RTC data channel to display
    // start display timer?
})
connections[0].callEnd();

// Engage a call with some peer:
// let peerGuid = availablePeers[0]
// let htmlVideoDisplay = document.getElementById('videoDisplayDiv')
// Call.start when video display is opened...
// Call.start( peerGuid, track => {
//     // check if the video display is open?

//     // when a track is coming through
//     htmlVideoDisplay.srcObject = track.streams[0] // Attach RTC data channel to display
//     // start display timer?
// })

// Call.end when video display is closed...
// We call this to let the client be able to stop transmiting their data
// (side affect, it lets the receiver know there is no data being shared)
// Call.end()

// Chat start...
// Chat.start( peerGuid, channel => {

// })
// Chat.send("hello")

// File transfer start...
// FileShare.send( peerGuid, file )
