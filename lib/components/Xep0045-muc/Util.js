'use strict';

var JID = require("@xmpp/jid"),
  ltx = require('ltx');

module.exports = {

  Error: {
    NotFound: ltx.parse('<error type=\'cancel\'><item-not-found xmlns=\'urn:ietf:params:xml:ns:xmpp-stanzas\'/></error>') // jshint ignore:line
  },

  getBareJid: function (jid) {
    var userjid = null;
    if (jid instanceof JID) {
      userjid = jid;
    } else {
      userjid = new JID(jid.toString());
    }

    return userjid.bare().toString();
  },

  determineRoomname: function (stanza) {
    var roomjid = new JID(stanza.attrs.to);
    return roomjid.getLocal();
  }
};