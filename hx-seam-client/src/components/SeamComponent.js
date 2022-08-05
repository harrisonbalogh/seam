import React from 'react';
import './seam.css';
import * as RelayClient from 'hx-seam-lib/RelayClient'
import * as Seam from 'hx-seam-lib/Seam'
import { STATUS as CONNECTION_STATUS } from 'hx-seam-lib/Seam'
import { BsFillShieldLockFill, BsArrowUpRight, BsArrowDownLeft,
  BsFillTelephonePlusFill, BsFillTelephoneXFill, BsFolderPlus, BsForwardFill, BsForward,
  BsArrowBarUp, BsArrowBarDown, BsChevronDoubleDown } from "react-icons/bs";

import { AUTH_DOMAIN } from '@harxer/seam-lib';
import { validateSession, invalidateSession } from '@harxer/session-manager-lib';
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
    validateSession(AUTH_DOMAIN).then(_ => this.handleLogin()).catch(_ => {})
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
      } else if (status === CONNECTION_STATUS.FileOpen) {
        this.forceUpdate()
      }
    })
    seamConnection.setChatNotifyMessage(m => {
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
      let className = data.source === "self" ? "client" : "peer"
      let source = data.source === "self" ? "Me: " : "Peer: "
      return <li ref={e => this.latestChatMsg = e} className={`chat-message-${className}`}><b>{source}</b>{data.message}</li>
    })
    let peerList = (peers) => {
      if (peers.length === 0) return (
        <li style={{color: 'gray', textAlign: 'center'}}>
           <i>No peers...</i>
        </li>
      )
      return peers.map(peer =>
        <li key={peers}
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
          <div id="p-peers">
            Peers:
            {RelayClient.isConnected() ? <div className="button-styleIcon" onClick={() => Seam.getPeers().forEach(connection => connection.close())}><BsChevronDoubleDown /></div> : undefined}
          </div>
          <ul id="ul-peers">
            {peerList(peers)}
          </ul>
        </div>
      )
    }
    let connectButton = connected => {
      if (!connected)
        return <div className="button-styleIcon" onClick={() => this.seamConnect(selectedPeer)}><BsArrowUpRight /></div>
      return <div className="button-styleIcon" onClick={() => connection.close()}><BsArrowDownLeft /></div>
    }
    let callButton = connected => {
      if (!connected) return

      if (connection.isCallOpen() || isChannelAccepted(Seam.CHANNEL_TYPE.Call)) {
        return <div className="button-styleIcon" onClick={() => {
          this.setState({videoStreamLocal: undefined, videoStreamRemote: undefined})
          connection.callEnd()
        }}><BsFillTelephoneXFill /></div>
      }

      return (<div className="button-styleIcon" onClick={() => {
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
      }}><BsFillTelephonePlusFill /></div>)
    }
    let fileShare = connected => {
      if (!connected) return

      return (
        <div className="button-styleIcon">
          <label class="file-upload-container">
            <input type="file" className="file-input" ref={elem => {
              if (elem)
                elem.addEventListener('change', e => elem.files.length && connection.fileOffer(elem.files[0]))
            }}/>
            <BsFolderPlus />
          </label>
        </div>
      )
    }
    let fileShareRequest = connected => {
      if (!connected) return
      let fileRequest = Seam.getFileRequest(selectedPeer)
      if (fileRequest === undefined) return
      let fileName =  (fileRequest.length > 1) ? fileRequest[1] : ""
      let fileSize =  (fileRequest.length > 2) ? fileRequest[2] : ""
      return <p id="btn-logout" className="button-style1" onClick={() => {
        connection.fileAccept(fileName, fileSize).then(_ => this.forceUpdate())
      }}><BsArrowBarDown />{`${fileName} (${fileSize})`}</p>
    }

    let actionContainer = () => {
      if (selectedPeer === undefined) return <div id="container-action"></div>
      let connected = connection !== undefined && connection.isChatOpen()

      return (
        <div id="container-action">
          {connectButton(connected)}
          {callButton(connected)}
          {fileShare(connected)}
          {fileShareRequest(connected)}

          {videoContainer()}
          {msgContainer()}
        </div>
      )
    }

    const onChatSendButton = () => {
      if (this.chatInput.value.trim() === "") return
      connection.chatMessage(this.chatInput.value)
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
        <input className="inputChat" ref={element => this.chatInput = element} onKeyPress={handlePasswordKeyPress} /> :
        <input className="inputChat disabled" disabled/>
      let sendButton = connection.isChatOpen() ?
        <div className="button-styleIcon" onClick={onChatSendButton}><BsForwardFill /></div> :
        <div className="button-styleIcon disabled"><BsForward /></div>

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

    let connectionContainer = () => {
      if (!RelayClient.isConnected()) return

      return (
        <div id="connection-container">
          {peerContainer()}
          {actionContainer()}
        </div>
      )
    }

    let guidLabel = () => {
      if (guid === undefined) return
      return RelayClient.isConnected() ?
        <p style={{display: "inline-block"}}>{guid}</p> :
        <p style={{display: "inline-block", textDecoration: "line-through", color: "gray"}}>{guid}</p>
    }

    return (
      <div className="container">
        <p id="btn-logout" className="button-style1" onClick={() => invalidateSession(AUTH_DOMAIN).then(_ => window.location.reload())}>Logout <BsFillShieldLockFill/></p>
        <div>
          <b>ID:</b> {guidLabel()}
          {!RelayClient.isConnected() ? <div className="button-styleIcon" onClick={() => this.relayConnect()}><BsArrowBarUp /></div> : undefined}
          {RelayClient.isConnected() ? <div className="button-styleIcon" onClick={() => RelayClient.disconnect()}><BsArrowBarDown /></div> : undefined}
        </div>
        {connectionContainer()}
      </div>
    )
  }
}

export default SeamComponent
