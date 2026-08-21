// Reproduce: TypeError: query.getSQL is not a function
require('./Q.inc')(function (Q) {
	var Db = Q.require('Db');
	var Streams = Q.plugins.Streams;
	var Users = Q.plugins.Users;

	console.log('--- booted ---');

	function step(name, fn) {
		return new Promise(function (resolve) {
			console.log('\n### ' + name);
			var done = false;
			var t = setTimeout(function () {
				if (!done) { console.log('  [TIMEOUT]'); done = true; resolve(); }
			}, 8000);
			try {
				fn(function (err, res) {
					if (done) return;
					done = true; clearTimeout(t);
					if (err) console.log('  [ERR]', err && (err.stack || err.message || err));
					else console.log('  [OK]', res === undefined ? '' : require('util').inspect(res, {depth:1}).slice(0,400));
					resolve();
				});
			} catch (e) {
				if (done) return;
				done = true; clearTimeout(t);
				console.log('  [THROW]', e.stack);
				resolve();
			}
		});
	}

	(async function () {
		await step('rawQuery (the reported crash path)', function (cb) {
			Streams.Stream.db().rawQuery('SELECT 1 AS one', []).execute(function (params) {
				cb(null, params);
			});
		});

		await step('SELECT via Db_Row', function (cb) {
			Streams.Stream.SELECT('*').limit(1).execute(function (err, rows) { cb(err, rows && rows.length); });
		});

		await step('Streams.Message.post', function (cb) {
			// signature is (fields, callback) -- no skipAccess argument
			Streams.Message.post({
				publisherId: 'Hebrews', streamName: 'Assets/NFTs',
				byUserId: 'Hebrews', type: 'Streams/chat/message', content: 'hi'
			}, function (err, message) {
				cb(err, message && ('ordinal=' + message.fields.ordinal));
			});
		});

		console.log('\n--- done ---');
		process.exit(0);
	})();
});
