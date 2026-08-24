// Integration: vector search through the JS model layer (generated Base classes).
require('./Q.inc')(function (Q) {
	var Db = Q.require('Db');
	var Hebrews = Q.plugins.Hebrews || Q.app;
	var pass = 0, fail = 0, failures = [];
	function ok(n,r){console.log('[OK]   '+n+(r?' :: '+String(r).slice(0,160):''));pass++;}
	function bad(n,e){console.log('[FAIL] '+n+' :: '+(e&&(e.message||e)));failures.push(n);fail++;}
	function ta(n,fn){return new Promise(function(res){var d=false;
		var t=setTimeout(function(){if(d)return;d=true;bad(n,new Error('TIMEOUT'));res();},15000);
		function fin(e,r){if(d)return;d=true;clearTimeout(t);e?bad(n,e):ok(n,r);res();}
		try{fn(fin);}catch(e){fin(e);}});}
	var DIM=768;
	function embed(text){var v=new Array(DIM).fill(0);
		var s=' '+String(text).toLowerCase().replace(/[^a-z0-9 ]/g,'')+' ';
		for(var i=0;i+3<=s.length;++i){var g=s.substr(i,3),h=5381;
			for(var j=0;j<g.length;++j)h=((h*33)^g.charCodeAt(j))>>>0; v[h%DIM]+=1;}
		var n=Math.sqrt(v.reduce(function(a,b){return a+b*b;},0))||1;
		return v.map(function(x){return x/n;});}

	(async function(){
		var Document = Q.require('Hebrews/Document');
		ok('model class loads', Document && (Document.name || 'Hebrews_Document'));

		await ta('Model.SELECT().vectorNearestTo().execute()', function(cb){
			Document.SELECT('*')
			.vectorNearestTo('embedding', Db.vector(embed('the cat sat on the warm mat')), {limit:2})
			.execute(function(err, rows){
				if(err) return cb(err);
				var got = rows.map(function(r){return r.fields.title;});
				if(got[0]!=='Warm cat') return cb(new Error('self not first: '+got));
				cb(null, got.join(' | '));
			});
		});
		await ta('rows are model instances', function(cb){
			Document.SELECT('*')
			.vectorNearestTo('embedding', Db.vector(embed('database migration')), {limit:1})
			.execute(function(err, rows){
				if(err) return cb(err);
				var r = rows[0];
				if(!r || !r.fields) return cb(new Error('not a row object'));
				cb(null, (r.constructor && r.constructor.name) + ' title=' + r.fields.title);
			});
		});
		await ta('where() + vectorNearestTo() compose', function(cb){
			Document.SELECT('*').where({publisherId:'Hebrews'})
			.vectorNearestTo('embedding', Db.vector(embed('database migration')), {limit:5})
			.execute(function(err, rows){
				if(err) return cb(err);
				var bad2 = rows.filter(function(r){return r.fields.publisherId!=='Hebrews';});
				if(bad2.length) return cb(new Error('filter leaked'));
				if(rows[0].fields.title!=='Migration ran') return cb(new Error('top='+rows[0].fields.title));
				cb(null, rows.length+' rows, top='+rows[0].fields.title);
			});
		});
		await ta('vector round-trips from the DB', function(cb){
			Document.SELECT('*').where({title:'Warm cat'}).limit(1).execute(function(err, rows){
				if(err) return cb(err);
				if(!rows.length) return cb(new Error('not found'));
				var raw = rows[0].fields.embedding;
				var Vector = Q.require('Db/Vector');
				// Db.vector() now handles every wire form: Buffer, bracketed
				// text, or the binary string the mysql driver returns
				var v = (raw && raw.typename==='Db.Vector') ? raw : Db.vector(raw);
				if(!v || v.dimensions() !== DIM) return cb(new Error('dims='+(v&&v.dimensions())));
				var want = embed('the cat sat on the warm mat');
				for(var k=0;k<DIM;++k) if(Math.abs(v.values[k]-want[k])>1e-6)
					return cb(new Error('component '+k+' differs'));
				cb(null, 'all 768 components match');
			});
		});
		await ta('INSERT a row via the Db layer stays searchable', function(cb){
			var body='a kitten dozes on a warm blanket';
			Document.db().INSERT('hebrews_document', {
				publisherId:'Hebrews', title:'Kitten', body:body,
				embeddingModel:'stub-768', embedding: Db.vector(embed(body))
			}).execute(function(err){
				if(err) return cb(err);
				Document.SELECT('*').vectorNearestTo('embedding', Db.vector(embed(body)), {limit:1})
				.execute(function(err, rows){
					if(err) return cb(err);
					if(!rows[0] || rows[0].fields.title!=='Kitten')
						return cb(new Error('not found: '+(rows[0]&&rows[0].fields.title)));
					cb(null, 'found immediately');
				});
			});
		});

		await ta('dimension mismatch is refused, not silently wrong', function (cb) {
			try {
				Document.SELECT('*').vectorNearestTo('embedding', Db.vector([1,0,0,0]), {limit:1});
			} catch (e) {
				if (e.message.indexOf('768-dimensional') < 0) return cb(new Error(e.message));
				return cb(null, 'refused');
			}
			cb(new Error('a 4-dim query against a VECTOR(768) column was allowed'));
		});
		await ta('correct dimensions still pass', function (cb) {
			try {
				Document.SELECT('*').vectorNearestTo('embedding',
					Db.vector(new Array(768).fill(0.1)), {limit:1});
				cb(null, 'accepted');
			} catch (e) { cb(e); }
		});

		console.log('\n==== JS model integration: '+pass+' passed, '+fail+' failed ====');
		if(failures.length) console.log('failed:\n  '+failures.join('\n  '));
		process.exit(fail?1:0);
	})();
});
