'use strict';

module.exports = function (sequelize, DataTypes) {
  var SubTypes = {
    'Both': 'both',
    'From': 'from',
    'To': 'to',
    'None': 'none'
  };

  var Roster = sequelize.define('Roster', {
    name: {
      type: DataTypes.STRING
    },
    subscription: {
      type: DataTypes.ENUM(
        SubTypes.Both,
        SubTypes.From,
        SubTypes.To,
        SubTypes.None
      )
    },
    // currently one group, but should be multiple, maybe we store groups seperately?
    group: {
      type: DataTypes.STRING,
    }
  }, {});

  return Roster;
};
