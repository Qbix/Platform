require('./Q.inc')(function (Q) {
	var Db = Q.require('Db');
	var Query = Q.require('Db/Query');
	var Sqlite = Q.require('Db/Query/Sqlite');
	var pass=0, fail=0;
	// fake adapter so we can exercise Query.prototype without a live sqlite file
	var fakeDb = { connName:'test', typename:'Db.Sqlite', prefix:function(){return 't_';}, dbname:function(){return 'testdb';} };
	function mk(type, clauses, table) { return new Sqlite(fakeDb, type, clauses||{}, {}, table); }
	function t(name, fn) {
		try { console.log('[OK]   '+name+' :: '+String(fn()).replace(/\s+/g,' ').trim().slice(0,200)); pass++; }
		catch(e) { console.log('[FAIL] '+name+' :: '+(e&&(e.message||e))); fail++; }
	}
	t('base SELECT+where', function(){ return mk(Query.TYPE_SELECT).SELECT('*','t_stream').where({publisherId:'x'}); });
	t('base where IN', function(){ return mk(Query.TYPE_SELECT).SELECT('*','t_stream').where({publisherId:['a','b']}); });
	t('base where NULL', function(){ return mk(Query.TYPE_SELECT).SELECT('*','t_stream').where({publisherId:null}); });
	t('base where Expression', function(){ return mk(Query.TYPE_SELECT).SELECT('*','t_stream').where(new Db.Expression('1=1')); });
	t('base join Expression', function(){ return mk(Query.TYPE_SELECT).SELECT('*','a').join('b', new Db.Expression('a.id=b.id')); });
	t('base andWhere', function(){ return mk(Query.TYPE_SELECT).SELECT('*','t').where({a:1}).andWhere({b:2}); });
	t('base orWhere', function(){ return mk(Query.TYPE_SELECT).SELECT('*','t').where({a:1}).orWhere({b:2}); });
	t('base groupBy/having', function(){ return mk(Query.TYPE_SELECT).SELECT('a, COUNT(1) c','t').groupBy('a').having({c:2}); });
	t('base orderBy/limit', function(){ return mk(Query.TYPE_SELECT).SELECT('*','t').orderBy('a', false).limit(5,2); });
	t('base UPDATE set', function(){ return mk(Query.TYPE_UPDATE, {UPDATE:'t'}).set({a:1}).where({b:2}); });
	t('base DELETE', function(){ return mk(Query.TYPE_DELETE, {FROM:'t'}).where({b:2}); });
	t('base after()', function(){ var q=mk(Query.TYPE_SELECT).SELECT('*','t').after('FROM','INDEXED BY i'); 
		if(!q.afterClauses.FROM) throw new Error('after lost'); return q; });
	t('base lock', function(){ return mk(Query.TYPE_SELECT).SELECT('*','t').lock('FOR UPDATE'); });
	t('base copy()', function(){ var q=mk(Query.TYPE_SELECT).SELECT('*','t').where({a:1}); var c=q.copy();
		if (String(c)!==String(q)) throw new Error('copy differs'); return c; });
	t('base shard()', function(){ var q=mk(Query.TYPE_SELECT).SELECT('*','t').where({a:1});
		var s=q.shard(); var k=Object.keys(s);
		k.forEach(function(x){ if(!s[x].build) throw new Error('shard value not a query'); });
		return 'keys=['+k.join('|')+']'; });
	console.log('\n==== base class: '+pass+' passed, '+fail+' failed ====');
	process.exit(fail?1:0);
});
