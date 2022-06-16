'use strict';
const SOCKET_OPEN = require('ws').OPEN;

const MSG_TYPE = {
  Available: "avail",
  Request: "request",
  Deny: "deny",
  Cancel: "cancel",
  Socket: "socket",
  Fail: "fail",
  Exit: "exit",
  Receive: "recv",
  Connected: "conn",
  Pulse: "pulse",
  Relay: "relay"
}

/**
 * Send fail message to msg source socket.
 * @param {*} msg - The failed message data with source/target as socket object.
 * @param {*} error - OPTIONAL Error message sent with message.
 */
function fail(msg, error = 'No specific error set.') {
  if (msg.source.readyState !== SOCKET_OPEN) return

  let target = msg.source
  // Preserve target field and convert for stringify
  msg.target = msg.target.id
  msg.source = msg.source.id

  target.send(JSON.stringify({type: MSG_TYPE.Fail, msg, error}));
}

/**
 * Send message to msg target. Formats data before sending.
 * @param {*} msg Message data with source/target as socket object.
 */
function relay(msg) {
  requireTarget(msg)

  let target = msg.target
  // Scrub target field and convert source to ID for stringify
  delete msg.target;
  msg.source = msg.source.id

  target.send(JSON.stringify(msg));
}

module.exports = {
  MSG_TYPE,
  fail,
  relay
}

/** Validator. Errors if msg.target is not defined or target socket is not open. */
function requireTarget(msg) {
  if (msg.target === undefined) throw new Error("No target provided.")
  if (msg.target.readyState !== SOCKET_OPEN) throw new Error(`Target socket not open. Socket state. ${typeof msg.target.readyState}: ${msg.target.readyState} vs ${typeof SOCKET_OPEN}: ${SOCKET_OPEN}`)
}
