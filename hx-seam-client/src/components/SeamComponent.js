import React from 'react';
import './seam.css';
import * as RelayClient from 'hx-seam-lib/RelayClient'
import * as Seam from 'hx-seam-lib/Seam'
import { STATUS as CONNECTION_STATUS } from 'hx-seam-lib/Seam'

import { validateSession, invalidateSession } from 'hx-session-manager/HXSessionManager';
import Login from './Login';

class SeamComponent extends React.Component {
  constructor(props) {
    super(props)

    this.handleLogin = this.handleLogin.bind(this);

    this.state = {
      loggedIn: false,
      guid: undefined,
      selectedPeer: undefined,
      peers: [],
      videoStreamLocal: undefined,
      videoStreamRemote: undefined
    }
  }

  componentDidMount() {
    validateSession().then(_ => this.handleLogin()).catch(_ => {})
    if (this.latestChatMsg) {
      this.latestChatMsg.scrollIntoView() // TODO immediate
    }
  }

  componentDidUpdate() {
    if (this.latestChatMsg) {
      this.latestChatMsg.scrollIntoView({ behavior: "smooth" })
    }
  }

  handleLogin() {
    this.setState({loggedIn: true})
  }

  setupRelayClient() {
    RelayClient.setNotifyAvailable(() => this.generatePeerList()) // Relay peer joined
    RelayClient.setNotifyExit(() => this.generatePeerList()) // Relay peer exited
    RelayClient.setNotifyClose(() => this.generatePeerList()) // Relay client connection lost
  }

  setupSeam() {
    RelayClient.setHandleRelay(Seam.handleRelay) // Required attach relay to seam
    Seam.setNotifyRequest(() => this.forceUpdate()) // New Offer
    Seam.setNotifyClosed(() => this.generatePeerList()) // Closed RTC
  }

  relayConnect() {
    this.setupRelayClient()
    this.setupSeam()
    RelayClient.connect((guid, _) => {
      this.generatePeerList()
      this.setState({guid: guid})
    })
  }

  async seamConnect(guid) {
    // TODO: Check if already connected to guid
    let seamConnection = await Seam.connect(guid, status => {
      if (status === CONNECTION_STATUS.Requested) {
          // Update UI with spinner
      } else if (status === CONNECTION_STATUS.Accepted) {
        if (this.videoStreamRemote && !seamConnection.isCallOpen()) {
          this.setState({videoStreamRemote: undefined})
        }
        this.forceUpdate()
      } else if (status === CONNECTION_STATUS.ChatOpen) {
        this.forceUpdate()
      } else if (status === CONNECTION_STATUS.ChatClosed) {
        this.forceUpdate()
      }
    })
    seamConnection.setHandleChatMessage(m => {
      seamConnection.chatData().push({source: guid, message: m})
      this.forceUpdate()
    })
    this.generatePeerList()
  }

  getConnection(guid) {
    return Seam.getPeer(guid)
  }

  /**
   * Updates selectedPeer and list of interactable peers based on conditions:
   * - If RelayServer is connected, all relay peers.
   * - All stable connected seam peers that don't collide with added relay peers.
   */
  generatePeerList() {
    let peers = new Set()
    // Relay peers
    if (RelayClient.isConnected()) {
      RelayClient.getPeers().forEach(peer => peers.add(peer))
    }
    // Stable Seam connections
    Seam.getOpenPeers().map(peer => peer.guid()).forEach(peer => peers.add(peer))
    // Verify selectedPeer is still in list - else clear it
    let selectedPeer = peers.has(this.state.selectedPeer) ? this.state.selectedPeer : undefined

    this.setState({selectedPeer, peers: Array.from(peers)})
  }

  render() {
    const { loggedIn, guid, selectedPeer, peers } = this.state;

    if (!loggedIn) {
      return <Login handleLogin={this.handleLogin}/>
    }

    const connection = this.getConnection(selectedPeer)
    const isChannelAccepted = type => connection && connection.acceptedChannels().has(type)

    let msgList = () => connection.chatData().map(data => {
      let className = data.source === guid ? "client" : "peer"
      let source = data.source === guid ? "Me: " : "Peer: "
      return <li ref={e => this.latestChatMsg = e} className={`chat-message-${className}`}><b>{source}</b>{data.message}</li>
    })

    let peerList = (peers) => {
      if (peers.length === 0) return (
        <li style={{color: 'gray', textAlign: 'center'}}>
           <i> No peers connected...</i>
        </li>
      )
      return peers.map(peer =>
        <li
          className={peer === selectedPeer ? 'selected' : ''}
          onClick={() => {
            this.setState({selectedPeer: (selectedPeer === peer) ? undefined : peer})
          }}
        >
          {`${peer}`}{Seam.hasRequest(peer) ? <div className="notification"></div> : undefined}
        </li>
      )
    }

    let peerContainer = () => {
      if (!RelayClient.isConnected() && peers.length === 0) return undefined

      return (
        <div id="container-peers">
          <p id="p-peers">
            Peers:
          </p>
          <ul id="ul-peers">
            {peerList(peers)}
          </ul>
        </div>
      )
    }

    let connectButton = connected => {
      if (!connected)
        return <p className="button-style1" onClick={() => this.seamConnect(selectedPeer)}>Connect</p>
      return <p className="button-style1" onClick={() => connection.close()}>Disconnect</p>
    }
    let callButton = connected => {
      if (!connected) return

      if (connection.isCallOpen() || isChannelAccepted(Seam.CHANNEL_TYPE.Call)) {
        return <p className="button-style1" onClick={() => {
          this.setState({videoStreamLocal: undefined, videoStreamRemote: undefined})
          connection.callEnd()
        }}>End Call</p>
      }

      return (<p className="button-style1" onClick={() => {
        // Local Cam
        navigator.mediaDevices.getUserMedia({
            audio: true,
            video: true
        }).then(stream => {
          this.setState({videoStreamLocal: stream})
        })

        // Remote Cam
        connection.callStart(stream => {
          this.setState({videoStreamRemote: stream})
        })
      }}>Call</p>)
    }

    let actionContainer = () => {
      if (selectedPeer === undefined) return
      let connected = connection !== undefined && connection.isChatOpen()
      let connectedCall = connection !== undefined && connection.isCallOpen()

      return (
        <div id="container-action">
          {connectButton(connected)}
          {callButton(connected)}
          {/*<p className="button-style1 disabled" onClick={() => {}}>File Share</p> */}
        </div>
      )
    }

    const onChatSendButton = () => {
      if (this.chatInput.value.trim() === "") return
      connection.chatMessage(this.chatInput.value.trim())
      connection.chatData().push({source: guid, message: this.chatInput.value.trim()})
      this.chatInput.value = ""
      this.forceUpdate()
    }
    const handlePasswordKeyPress = e => {
      if(e.key === 'Enter'){
        onChatSendButton()
      }
    }

    let msgContainer = () => {
      if (!isChannelAccepted(Seam.CHANNEL_TYPE.Chat)) return

      let inputField = connection.isChatOpen() ?
        <input ref={element => this.chatInput = element} onKeyPress={handlePasswordKeyPress}></input> :
        <input disabled className="disabled"></input>
      let sendButton = connection.isChatOpen() ?
        <p className="button-style1" onClick={onChatSendButton}>Send</p> :
        <p className="button-style1 disabled">Send</p>

      return (
        <div id="container-chatMsgs">
          <ul ref={element => this.chatMsgContainer = element}>
            {msgList()}
          </ul>
          {inputField}
          {sendButton}
        </div>
      )
    }

    let videoContainer = () => {
      if (!isChannelAccepted(Seam.CHANNEL_TYPE.Call)) return

      return (
        <div id="container-video">
          <video className="video-remote" ref={vid => {
            if (vid) vid.srcObject = this.state.videoStreamRemote
          }} autoPlay />
          <video className="video-local" ref={vid => {
            if (vid) vid.srcObject = this.state.videoStreamLocal
          }} autoPlay />
        </div>
      )
    }

    return (
      <div className="container">
        <p>
          <b>Auth:</b> Logged in!
        </p>
        <p className="button-style1" onClick={() => invalidateSession().then(_ => window.location.reload(false))}>Logout</p>
        <p>
          <b>Socket:</b> {`${guid}`}
        </p>
        {!RelayClient.isConnected() ? <p className="button-style1" onClick={() => this.relayConnect()}>Connect</p> : undefined}
        {RelayClient.isConnected() ? <p className="button-style1" onClick={() => RelayClient.disconnect()}>Disconnect</p> : undefined}
        {RelayClient.isConnected() ? <p className="button-style1" onClick={() => Seam.getPeers().forEach(connection => connection.close())}>Drop Peers</p> : undefined}
        {peerContainer()}
        {actionContainer()}
        {msgContainer()}
        {videoContainer()}
      </div>
    )
  }
}

export default SeamComponent
