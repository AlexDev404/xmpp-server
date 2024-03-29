'use strict';

var ltx = require('ltx'),
  util = require('util'),
  XModule = require('../../../../core/XModule'),
  JID = require("@xmpp/jid"),
  logger = require('../../../../core/Logger')('roster');

var NS_ROASTER = 'jabber:iq:roster';

/*
 * RFC 3921: Roster
 * http://xmpp.org/rfcs/rfc3921.html#roster
 */
function Roster(options) {
  // initialize options
  if (!options) {
    options = {};
  }

  this.options = options;

  XModule.call(this);

  this.storage = options.storage;

  logger.info('load ' + this.name);
}
util.inherits(Roster, XModule);

Roster.prototype.name = 'RFC 3921: Roster';
Roster.prototype.version = '0.1.0';

Roster.prototype.Error = {
  NotFound: ltx.parse('<error type=\'cancel\'><item-not-found xmlns=\'urn:ietf:params:xml:ns:xmpp-stanzas\'/></error>')
};

Roster.prototype.initialize = function () {};

/*
 * Detects if the stanza is a roster request
 *
 * Sample:
 * <iq from='juliet@example.com/balcony' type='get' id='roster_1'>
 *   <query xmlns='jabber:iq:roster'/>
 * </iq>
 */
Roster.prototype.match = function (stanza) {
  if (stanza.is('iq') && stanza.attrs.type === 'get' && (stanza.getChild('query', NS_ROASTER))) {
    logger.debug('detected roster get request');
    return true;
  } else if (stanza.is('iq') && stanza.attrs.type === 'set' && (stanza.getChild('query', NS_ROASTER))) {
    logger.debug('detected roster set request');
    return true;
  }
  return false;
};

Roster.prototype.convertXMLtoJSON = function (xmlItem) {

  var item = {};
  // set jid
  item.jid = xmlItem.attrs.jid;

  // set name
  if (xmlItem.attrs.name) {
    item.name = xmlItem.attrs.name;
  }

  var groupItems = [];
  var groups = xmlItem.getChildren('group');
  for (var i = 0; i < groups.length; i++) {
    groupItems.push(groups[i].getText());
  }
  item.group = JSON.stringify(groupItems);

  logger.debug('Converted ' + xmlItem.toString() + ' to ' + JSON.stringify(item));
      
  return item;
};

Roster.prototype.convertJSONItemtoXML = function (item, xmlQuery) {
  var xitem = xmlQuery.c('item', {
    jid: item.jid,
    name: item.Roster.name,
    subscription: item.Roster.subscription
  });

  // iterate over group items
  if (item.Roster.group) {
    try {
      var groups = JSON.parse(item.Roster.group);
      for (var j = 0; j < groups.length; j++) {
        logger.debug(groups[j]);
        xitem.c('group').t(groups[j]);
      }
    } catch (err) {
      logger.warn(err);
    }
  }
}

Roster.prototype.convertJSONtoXML = function (jsonList) {
  var query = new ltx.Element('query', {
    xmlns: NS_ROASTER
  });

  for (var i = 0; i < jsonList.length; i++) {
    this.convertJSONItemtoXML(jsonList[i], query);
  }

  logger.debug('Converted ' + jsonList.toString() + ' to ' + JSON.stringify(query));

  return query;
};

Roster.prototype.generateRosterResultMessage = function (params) {
  var rosterResult = new ltx.Element('iq', {
    from: params.to,
    to: params.from,
    id: params.id,
    type: 'result'
  });

  if (!params.list) {
    params.list = [];
  }

  rosterResult.cnode(this.convertJSONtoXML(params.list));
  return rosterResult;
}

/**
 * Returns the roster list
 */
Roster.prototype.handleGetRoster = function (stanza) {
  logger.debug('handleGetRoster ' + stanza.toString());
  var self = this;
  var storage = this.storage;

  var jid = new JID(stanza.attrs.from).bare();

  var transaction = null;
  var resultList = null;
  storage.sequelize.transaction().then(function (t) {
    transaction = t;
    return storage.findUser(jid.toString(), {
      transaction: transaction
    });
  }).then(function (user) {
    logger.debug('roster user: ' + JSON.stringify(user));
    return user.getRoster({
      transaction: transaction
    });
  }).then(function(list){
    resultList = list;
    return transaction.commit();
  }).then(function () {
    
    logger.debug('roster entries: ' + JSON.stringify(resultList));

    var rosterResult = self.generateRosterResultMessage({
      'from' : stanza.attrs.from, 
      'to' : stanza.attrs.to,
      'id' : stanza.attrs.id,
      'list' : resultList
    });
    
    logger.debug('send roster to ' + stanza.attrs.from + ' ' + rosterResult.toString() );
    self.send(rosterResult);

  }).catch(function (err) {
    logger.warn(err);
    transaction.rollback();
    self.sendError(stanza);
  });
};

/**
 * Verifies a roster item before we store it
 * @param  {[type]} item json roster item
 * @return {[type]}      true if the item is okay
 */
Roster.prototype.verifyItem = function (item) {
  if ((item === null) ||
    (item.jid === null) ||
    (item.jid === undefined)) {
    logger.error('jid not set for roster item');
    return false;
  }
  return true;
};

/**
 * Updates a roster item
 */
Roster.prototype.handleUpdateRosterItem = function (stanza, item) {
  logger.debug('handleUpdateRosterItem ' + stanza.toString());
    var self = this;
    var storage = this.storage;

    var rosteritem = null;
    var transaction = null;
    var user = null;

    storage.sequelize.transaction().then(function (t) {
      transaction = t;

      var jid = new JID(stanza.attrs.from).bare();
      return storage.findUser(jid.toString(), {
        transaction: transaction
      })
    }).then(function (usr) {
      user = usr;

      if (!usr) {
        throw new Error('could not find user')
      }

      logger.debug(item.toString())
      rosteritem = self.convertXMLtoJSON(item);
      
      if (!self.verifyItem(rosteritem)) {
        throw new Error('roster item not properly set');
      }
      
      // search friend
      return storage.findOrCreateUser(rosteritem.jid.toString(), {
        transaction: transaction
      })
    }).spread(function (friend, created) { // jshint ignore:line

      logger.debug(JSON.stringify(user))
      logger.debug(JSON.stringify(friend))

      if (!friend) {
        throw new Error('could not create the roster jid');
      }
        
      // extract from rosteritem
      return user.addRoster(friend, {
        name: rosteritem.name,
        group: rosteritem.group,
        subscription: 'none',
        transaction : transaction
      });
    }).then(function () {
      return transaction.commit();
    }).then(function () {
      self.sendSuccess(stanza);
    }).catch(function (err) {
      // lets catch error and respond with
      logger.warn(err);
      transaction.rollback();
      self.sendError(stanza);
    });
};

/**
 * Deletes a roster item
 */
Roster.prototype.handleDeleteRosterItem = function (stanza, item) {
  logger.debug('handleDeleteRosterItem ' + stanza.toString());

  var self = this;
  var storage = this.storage;
  var user, transaction = null;
  var dbopts = {};

  // TODO: search both user with one request
  // eg. find user with rosters and delete the specific roster
  storage.sequelize.transaction().then(function (t) {
    transaction = t;
    dbopts = {
      transaction: transaction
    };

    var jid = new JID(stanza.attrs.from).bare();
    return storage.findUser(jid.toString(), dbopts)
  }).then(function (u) {
    user = u;
    if (user) {
      throw new Error('no user found');
    }

    var rosteritem = this.convertXMLtoJSON(item);

    if (!this.verifyItem(rosteritem)) {
      throw new Error('roster item not properly set');
    }

    // search friend
    return storage.findOrCreateUser(rosteritem.jid.toString(), dbopts)
  }).then(function (friend) {

    if (!friend) {
      throw new Error('could not create the roster jid');
    }

    // extract from rosteritem
    return user.removeRoster(friend, dbopts)
  }).then(function () {
    self.sendSuccess(stanza);    
  }).catch(function (err) {
    logger.error(err);
    transaction.rollback();
    self.sendError(stanza);
  });
};

/** 
 * handles the component requests
 */
Roster.prototype.handle = function (stanza) {

  // return roster list
  if (stanza.attrs.type === 'get') {
    this.handleGetRoster(stanza);
    return true;
  }
  // update or remove
  else if (stanza.attrs.type === 'set') {
    var query = stanza.getChild('query', NS_ROASTER);
    var item = query.getChild('item');

    // delete an item
    if (item.attrs.subscription === 'remove') {
      this.handleDeleteRosterItem(stanza, item);
      return true;
    }
    // update an item
    else {
      this.handleUpdateRosterItem(stanza, item);
      return true;
    }
  }

  return false;
};

module.exports = Roster;
