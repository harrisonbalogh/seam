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
      guid: null,
      peers: [], // RelayService peer GUIDs
      connections: [], // Connection objects
      selectedPeer: undefined,
      videoStreamLocal: undefined,
      videoStreamRemote: undefined,
      chatMsgs: []
    }
  }

  componentDidMount() {
    validateSession().then(_ => this.handleLogin()).catch(_ => {})
  }

  handleLogin() {
    this.setState({loggedIn: true})
  }

  signalServerConnect() {
    // Disconnect existing connection
    if (this.state.guid) {
      RelayClient.disconnect()
    }

    RelayClient.setHandleRelay(Seam.handleRelay)
    RelayClient.setNotifyAvailable((guid) => this.setState({peers: this.state.peers.concat([guid])}))
    RelayClient.setNotifyExit((guid) => {
      for (let p = 0; p < this.state.peers.length; p++) {
        if (this.state.peers[p] === guid) {
          this.setState({
            peers: this.state.peers.slice(0, p).concat(this.state.peers.slice(p + 1)),
            selectedPeer: guid === this.state.selectedPeer ? null : this.state.selectedPeer
          })
          break
        }
      }
    })
    RelayClient.setNotifyClose(_ => this.setState({guid: null, peers: []}))
    RelayClient.connect(guid => this.setState({guid: guid}))

    Seam.setNotifyRequest(() => {
      this.forceUpdate()
    })
    Seam.setNotifyClosed(() => {
        // TODO Close RTC screen.
        this.forceUpdate()
    })
  }
  signalServerDisconnect() {
    RelayClient.disconnect()
    this.setState({guid: undefined})
  }

  async seamConnect(guid) {
    // TODO: Check if already connected to guid
    let seamConnection = await Seam.connect(guid, status => {
      if (status === CONNECTION_STATUS.Requested) {
          // Update UI with spinner
      } else if (status === CONNECTION_STATUS.Accepted) {
          // Update UI connection chat
      } else if (status === CONNECTION_STATUS.StableChat) {
        this.forceUpdate()
      }
    })
    seamConnection.setHandleChatMessage(m => {
      this.setState({chatMsgs: this.state.chatMsgs.concat([m])})
    })
    this.setState({connections: this.state.connections.concat([seamConnection])})
  }

  getConnection(guid) {
    return this.state.connections.find(c => c.guid() === guid)
  }

  render() {
    const { loggedIn, guid, peers, selectedPeer, chatMsgs } = this.state;

    if (!loggedIn) {
      return <Login handleLogin={this.handleLogin}/>
    }

    const connection = this.getConnection(selectedPeer)
    const isChannelAccepted = type => connection && connection.acceptedChannels().has(type)

    let msgList = () => {
      return chatMsgs.map(msg => (
        <li>{`${msg}`}</li>
      ))
    }

    let peerList = () => {
      if (peers.length === 0) return (
        <li style={{color: 'gray', textAlign: 'center'}}>
           <i> No peers connected...</i>
        </li>
      )
      return peers.map(peer =>
        <li
          className={peer === selectedPeer ? 'selected' : ''}
          onClick={() => {
            this.setState({selectedPeer: (selectedPeer === peer) ? null : peer})
          }}
        >
          {`${peer}`}{Seam.hasRequest(peer) ? <div className="notification"></div> : null}
        </li>
      )
    }

    let peerContainer = () => {
      if (!guid) return null

      return (
        <div id="container-peers">
          <p id="p-peers">
            Peers:
          </p>
          <ul id="ul-peers">
            {peerList()}
          </ul>
        </div>
      )
    }

    let connectButton = connected => {
      if (!connected)
        return <p className="button-style1" onClick={() => this.seamConnect(selectedPeer)}>Connect</p>
      return <p className="button-style1 disabled">Connect</p>
    }
    let callButton = connected => {
      if (!connected) return

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
      let connected = connection !== undefined && connection.isStable()

      return (
        <div id="container-action">
          {connectButton(connected)}
          {callButton(connected)}
          {/*<p className="button-style1 disabled" onClick={() => {}}>File Share</p> */}
        </div>
      )
    }

    let msgContainer = () => {
      if (!isChannelAccepted(Seam.CHANNEL_TYPE.Chat)) return

      return (
        <div id="container-chatMsgs">
          <ul>
            {msgList()}
          </ul>
          <input ref={element => this.chatInput = element}></input>
          <p className="button-style1" onClick={() => {
            connection.chatMessage(this.chatInput.value)
          } }>Send</p>
        </div>
      )
    }

    let videoContainerLocal = () => {
      if (!isChannelAccepted(Seam.CHANNEL_TYPE.Call)) return
      if (this.state.videoStreamLocal === undefined) return

      return (
        <div id="container-video">
          <p>Video Local</p>
          <video ref={vid => {
            if (vid) vid.srcObject = this.state.videoStreamLocal
          }} autoPlay />
        </div>
      )
    }

    let videoContainerRemote = () => {
      if (!isChannelAccepted(Seam.CHANNEL_TYPE.Call)) return
      if (this.state.videoStreamRemote === undefined) return

      return (
        <div id="container-video">
          <p>Video Remote</p>
          <video ref={vid => {
            if (vid) vid.srcObject = this.state.videoStreamRemote
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
        {!guid ? <p className="button-style1" onClick={() => this.signalServerConnect()}>Connect</p> : null}
        {guid ? <p className="button-style1" onClick={() => this.signalServerDisconnect()}>Disconnect</p> : null}
        {peerContainer()}
        {actionContainer()}
        {msgContainer()}
        {videoContainerLocal()}
        {videoContainerRemote()}
      </div>
    )
  }
}

export default SeamComponent
