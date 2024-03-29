/**
 * Autogenerated base class for the Assets model.
 * 
 * Don't change this file, since it can be overwritten.
 * Instead, change the Assets.js file.
 *
 * @module Assets
 */
var Q = require('Q');
var Db = Q.require('Db');

/**
 * Base class for the Assets model
 * @namespace Base
 * @class Assets
 * @static
 */
function Base () {
	return this;
}
 
module.exports = Base;

/**
 * The list of model classes
 * @property tableClasses
 * @type array
 */
Base.tableClasses = [
	"Assets_Badge",
	"Assets_Charge",
	"Assets_Connected",
	"Assets_Credits",
	"Assets_Customer",
	"Assets_Earned",
	"Assets_Leader",
	"Assets_NftAttributes"
];

/**
 * This method calls Db.connect() using information stored in the configuration.
 * If this has already been called, then the same db object is returned.
 * @method db
 * @return {Db} The database connection
 */
Base.db = function () {
	return Db.connect('Assets');
};

/**
 * The connection name for the class
 * @method connectionName
 * @return {string} The name of the connection
 */
Base.connectionName = function() {
	return 'Assets';
};

/**
 * Link to Assets.Badge model
 * @property Badge
 * @type Assets.Badge
 */
Base.Badge = Q.require('Assets/Badge');

/**
 * Link to Assets.Charge model
 * @property Charge
 * @type Assets.Charge
 */
Base.Charge = Q.require('Assets/Charge');

/**
 * Link to Assets.Connected model
 * @property Connected
 * @type Assets.Connected
 */
Base.Connected = Q.require('Assets/Connected');

/**
 * Link to Assets.Credits model
 * @property Credits
 * @type Assets.Credits
 */
Base.Credits = Q.require('Assets/Credits');

/**
 * Link to Assets.Customer model
 * @property Customer
 * @type Assets.Customer
 */
Base.Customer = Q.require('Assets/Customer');

/**
 * Link to Assets.Earned model
 * @property Earned
 * @type Assets.Earned
 */
Base.Earned = Q.require('Assets/Earned');

/**
 * Link to Assets.Leader model
 * @property Leader
 * @type Assets.Leader
 */
Base.Leader = Q.require('Assets/Leader');

/**
 * Link to Assets.NftAttributes model
 * @property NftAttributes
 * @type Assets.NftAttributes
 */
Base.NftAttributes = Q.require('Assets/NftAttributes');
