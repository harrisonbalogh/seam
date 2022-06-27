const jwt = require('jsonwebtoken'),
      Controller = require('./controller'),
      MsgType = Controller.MSG_TYPE,
      fs = require('fs'),
      // secret = JSON.parse(fs.readFileSync("key.json")).secret,
      WebSocketServer = require('ws').Server,
      domain = require("../config.js").domain;
      HXAuthServiceClient = require('./HXAuthServiceClient');

const verifyClient = (info, verified) => {
  if (domain == "localhost") return verified(true)

  if (info.req.headers.cookie === undefined) {
    console.log("No JWT.")
    return verified(false, 403, 'No token provided')
  }
  let token = info.req.headers.cookie.replace("jwt=","");
  if (!token) {
    console.log("Denied access to WebSocket. No token provided.");
    verified(false, 403, 'No token provided.');
  } else {
    HXAuthServiceClient.validate(token).then(_ => {
      verified(true);
    }).catch(e => {
      console.log(`${new Date()} - Failed to authenticate: ${e}`)
      verified(false, 403, 'Failed to authenticate.')
    }); // TODO
    // jwt.verify(token, secret, function (err, decoded) {
    //   if (err) {
    //     console.log("Denied access to WebSocket. Invalid token.");
    //     verified(false, 403, 'Failed to authenticate.')
    //   } else {
    //     info.req.decoded = decoded;
    //     if (decoded.privilege < 0) {
    //       verified(false, 401, 'You do not have permission to use this module.')
    //     }
    //     verified(true);
    //   }
    // })
  }
}

exports.clients = [];

exports.listen = port => {
  if (exports.clients.length > 10) return // TODO: Review cap

  let socketServer = new WebSocketServer({port, verifyClient})
  socketServer.on('connection', (socket, req) => {
    let date = new Date()
    socket.id = hashString(`${req.headers['x-real-ip']}${date}${exports.clients.length}`)

    console.log(`${date} - Connected client ${exports.clients.length} with ID(${socket.id}) from IP(${req.headers['x-real-ip']}).`)

    // Inform other clients of new peer with 'avail' message
    exports.clients.forEach(client => client.send(JSON.stringify({type: MsgType.Available, source: socket.id})))

    // Inform new client of its GUID and peers with 'conn' message
    socket.send(JSON.stringify({type: MsgType.Connected, guid: socket.id, clients: exports.clients.map(c => c.id)}));

    socket.on('message', msg => handleOnMessage(msg, socket))
    socket.on('close', _ => handleOnClose(socket))
    exports.clients.push(socket);
  })
}

/** Socket 'message' event handler. */
function handleOnMessage(msg, socket) {
  msg = JSON.parse(msg);
  msg.source = socket;
  msg.target = exports.clients.find(client => client.id === msg.target)

  if (msg.type === MsgType.Pulse) {
    // Pulse messages can be discarded
    return
  }
  if (msg.type === MsgType.Relay) {
    // TODO target is missing? Return error?
    Controller.relay(msg)
    return
  }
  Controller.fail(msg, "Unrecognized message type.")
}

/** Socket 'close' event handler. */
function handleOnClose(socket) {
  // Remove this socket from list
  exports.clients.splice(exports.clients.indexOf(socket), 1); // TODO: Is this concurrent-safe?
  // Inform other sockets of the socket closing
  exports.clients.forEach(client => client.send(JSON.stringify({type: MsgType.Exit, source: socket.id})))
}

/**
 * Helper for hashing a given string.
 * @param {String} str
 * @returns Hash of given string.
 */
function hashString(str) {
  let res = 0,
      len = str.length;
  for (let i = 0; i < len; i++) {
    res = res * 31 + str.charCodeAt(i);
    res |= 0;
  }
  return (res >>> 0); // force number above zero
 }