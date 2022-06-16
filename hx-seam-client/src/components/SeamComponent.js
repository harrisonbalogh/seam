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
      peers: [],
      connections: [],
      selectedPeer: null,
      requests: new Set(),
      chatPeer: undefined,
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

    Seam.setNotifyRequest(peer => {
      let requests = this.state.requests
      requests.add(peer)
      this.setState({requests})
    })
    Seam.setNotifyClosed(peer => {
        // Close RTC screen.

        // Remove request notifications.
        let requests = this.state.requests
        requests.remove(peer)
        this.setState({requests})
    })
  }
  signalServerDisconnect() {
    RelayClient.disconnect()
  }

  seamConnect(guid) {
    let seamConnectionA = Seam.connect(guid, status => {
      if (status === CONNECTION_STATUS.Requested) {
          // Update UI with spinner
      } else if (status === CONNECTION_STATUS.Accepted) {
          // Update UI connection chat
      }
    })
    this.setState({connections: this.state.connections.concat([seamConnectionA])})
  }

  render() {
    const { loggedIn, guid, peers, selectedPeer, requests, chatPeer, chatMsgs } = this.state;

    if (!loggedIn) {
      return <Login handleLogin={this.handleLogin}/>
    }

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
          {`${peer}`}{requests.has(peer) ? <div className="notification"></div> : null}
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

    let actionContainer = () => {
      if (!selectedPeer) return null

      return (
        <div id="container-action">
          <p className="button-style1" onClick={() => this.seamConnect(selectedPeer)}>Connect</p>
          {/* <p className="button-style1 disabled" onClick={() => {
            Call.start( selectedPeer, track => {
              console.log('Got track.')
            })
          }}>Call</p>
          <p className="button-style1 disabled" onClick={() => {}}>Chat</p>
          <p className="button-style1 disabled" onClick={() => {}}>File Share</p> */}
        </div>
      )
    }

    let msgContainer = () => {
      if (chatPeer !== selectedPeer) return

      return (
        <div id="container-chatMsgs">
          <ul>
            {msgList()}
          </ul>
          <input ref={element => this.chatInput = element}></input>
          <p className="button-style1" onClick={() => {
            // Chat.send(this.chatInput.value)
          } }>Send</p>
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
      </div>
    )
  }
}

export default SeamComponent
