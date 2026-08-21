# Db fixes — `TypeError: query.getSQL is not a function`

Four files changed, all JavaScript. **No PHP file was modified** — the PHP `Db_Query`
is the working reference and everything here was ported against it.

```
classes/Db.js                    dbms -> adapter name mapping
classes/Db/Query.js              base class
classes/Db/Query/Mysql.js        MySQL adapter
classes/Db/Query/Postgres.js     Postgres adapter result shape
```

Drop them over `platform/classes/`. `Db.patch` is the same change as a
`git apply`-able diff against `Qbix/Platform` @ `c200fe2`.

---

## The reported crash

`Db/Query.js`:

```js
Query.prototype.shard = function(index) {
    this.cachedShardIndex = index;
    return this;                       // <-- returns the query
};
```

`shard()` is contracted to return a map of `{shardName: query}` pairs. PHP's
`Db_Query::shard()` returns `array("" => $this)` in the unsharded case,
`array("*" => $this)` when criteria are insufficient, and `shard_internal()`
otherwise.

Returning `this` meant `execute()` did:

```js
var queries = shards || this.shard(options.indexes);   // a Query, not a map
for (shardName in queries) {                           // iterates criteria, table, clauses...
    _queryShard(queries[shardName], ...);              // hands over a plain object
}
```

and `_queryShard` called `.getSQL()` on `mq.criteria`. Because property order is
fixed, it failed identically on the first key for every query — this was never
specific to `Streams_Message.post`. Before the fix, `rawQuery`, `SELECT`, and
`Message.post` all threw the same trace; **no query could execute at all.**

Introduced by `2a136a7` ("Implemented support for Sqlite and Postgres in Node.js"),
which extracted `Db/Query.js` as a base class and left `shard()`, `shardIndex()`,
and `copy()` as stubs instead of ports.

---

## Important: which base-class methods are actually live

`Query_Sqlite` and `Query_Postgres` both begin with
`Db.Query.Mysql.call(this, ...)`, and `Query_Mysql` assigns **every builder method
onto the instance** inside its constructor closure. So on all three adapters, the
`Query.prototype` builders are shadowed and unreachable:

| Method | Resolves to |
|---|---|
| `SELECT`, `where`, `join`, `build`, `set`, `onDuplicateKeyUpdate`, `after`, `getClause` | shadowed by `Query_Mysql` instance methods |
| `copy`, `shard`, `shardIndex`, `_column`, `_criteria_expression`, `applyHash` | **base class — live on all three adapters** |

This matters for reading the fix list below:

- Fixes to `shard`, `shardIndex`, `copy`, `_criteria_expression`, `_column`
  affect **MySQL, SQLite, and Postgres alike**. These are the ones that were
  breaking production.
- Fixes to the base-class *builders* (the `Db` namespace getters, the
  `criteria_internal` references, the `set()` double-append, `setAfter`) repair
  code that no current adapter reaches. They are still real bugs — the base class
  could not build a single query, so anyone instantiating `Db.Query` directly or
  writing an adapter that does **not** delegate to `Query_Mysql` would hit them
  immediately — but they were not causing live failures today.

I previously described `basetest.js` as exercising `Query.prototype`. It does not:
because it constructs through the Sqlite adapter, it exercises `Query_Mysql`'s
instance builders plus the live base methods above. It is still a useful suite,
but that is what it covers.

---

## `classes/Db/Query.js`

### 1. The `Db` namespace resolved to `undefined` everywhere

```js
var _Db;
function Db() { if (!_Db) _Db = Q.require('Db'); return _Db; }
```

`Db` is a *function*, so `Db.Query`, `Db.Expression`, and `Db.Range` were all
`undefined` on the function object. Every `switch (this.type) { case Db.Query.TYPE_SELECT:`
in the file was a guaranteed TypeError. Fixed with lazy property getters so both
`Db()` and `Db.Xyz` call styles resolve. *(Builder-path — see the table above.)*

### 2. Calls to helpers that do not exist

`criteria_internal(this, x)`, `set_internal(...)`, `onDuplicateKeyUpdate_internal(...)`
were called as free functions never defined in the file; `new Db_Expression(...)`
and three bare `new Exception(...)` were ReferenceErrors;
`Db.Query.Mysql.column(...)` hardcoded the MySQL quoter in the DBMS-agnostic base.
*(Builder-path.)*

### 3. `set()` / `onDuplicateKeyUpdate()` stringified the query into the SQL

`_set_internal` already appends to the clause *and* returns the query; the caller
appended that return value again, so the whole Query object was `toString()`-ed
into the SET clause. *(Builder-path.)*

### 4. `setAfter()` destroyed the after-clause map

`this.after = this.after[after] ? ... : clause` assigned to `this.after` instead of
`this.after[after]`, replacing the map with a string. *(Builder-path.)*

### 5. `copy()` returned an object with no methods — **LIVE**

`Q.copy(this)` produces a plain object. Since the adapters assign every method onto
the *instance*, a copied query lost `getSQL`, `execute`, and `build` outright. Now
constructs a real instance of the same class and copies state across. Verified on
all three adapters.

### 6. `shardIndex()` read the wrong config path — **LIVE**

Looked up `Db/internal/sharding/{conn}/{table}` with `_` → `/` translation. PHP
reads `Db/upcoming/{conn}` falling back to `Db/connections/{conn}`, then
`['indexes'][className]` with underscores intact. The old `shard()` also wrote its
argument into `cachedShardIndex`, poisoning `shardIndex()`'s cache.

### 7. Ported from PHP — **LIVE**

`shard()`, `_shard_internal()`, `slice_partitions()`, `applyHash()`, `HASH_LEN`.

**JS-specific trap:** partition points such as `"4000000"` are integer-like strings,
and JS moves those to the front of an object's key order in ascending numeric order.
PHP preserves insertion order. Using a plain object for the partition map silently
scrambled the partition and tripped the "point N is not greater than the previous
point" guard. The mapping is now an ordered array of `[point, shardName]` pairs.

---

## `classes/Db/Query/Mysql.js`

Everything here is live on **all three adapters**, since SQLite and Postgres
delegate their builders to `Query_Mysql`.

### 8. `options.shards` as an array was a silent no-op

```js
var shards2 = {};
for (var i=0; i<shards.length; ++i) {
    shards[ shards[i] ] = mq;      // writes into the array, not shards2
}
shards = shards2;                  // always {}
```

The query never ran, the Pipe fired with no results, and the caller got a silent
success.

### 9. `mq.after` clobbered the `this.after` data map

The base constructor sets `this.after = {}`; the adapter then assigned an `after()`
*method* over it, so `build()` read `this.after['SELECT']` off a function and every
after-clause silently vanished. Storage moved to `this.afterClauses`.

### 10. `fillCriteria[column]` — undeclared variable

In the tuple-criteria branch `column` was never declared (a leaked global), so
`fillCriteria[undefined].push(...)` threw whenever tuple criteria met sharding
heuristics.

### 11. Stray `debugger;` in `_queryConnection`

Halts the process whenever an inspector is attached and the SQL contains `(,`.

### 12. `Db.Expression` was enumerated as a plain object

`criteria_internal` checked `typeof criteria === 'object'` **before** the
`typename === "Db.Expression"` check. A `Db.Expression` is a JS object, so it
matched first and its own properties were walked into the clause:

```sql
-- where(new Db.Expression('1=1')) produced:
WHERE `expression` = :_criteria_10 AND `typename` = :_criteria_11
  AND `parameters` = :_criteria_12 AND `toString` = :_criteria_13
  AND `valueOf` = :_criteria_14
```

`join()` was mangled the same way. PHP is immune because it checks `is_array()`
first. Both now test `typename` first. Silently wrong SQL, no error — caught by the
test suite, not by reading.

### 13. `ISNULL(col)` with an unquoted column

PHP emits `` `col` IS NULL ``. The unquoted form breaks on reserved-word columns.

### 14. SET columns were not quoted

`SET name = :_set_1` → `` SET `name` = :_set_1 ``, matching `Db_Query::set_internal`.

---

## `classes/Db.js` — Postgres was unreachable

### 15. `pgsql:` DSNs resolved to a module that does not exist

```js
var moduleName = dbms.charAt(0).toUpperCase() + dbms.substring(1);
Db[moduleName] = Q.require('Db/' + moduleName);
```

`pgsql:` → `Db/Pgsql`, but the file is `Db/Postgres.js`. Every attempt to connect
threw `Q.require: file 'Db/Pgsql' not found`. `Db.php` has a `$dbmsMap` for exactly
this; the JS port dropped it. Ported it over, including `postgres`/`postgresql`/
`sqlite3` aliases.

**The Postgres adapter could not be loaded at all before this fix.**

---

## `classes/Db/Query/Postgres.js` — wrong result shape

### 16. Raw pg rows instead of Db.Row instances

```js
callback(null, result.rows || [], result.fields || null);
```

Mysql and Sqlite both hand back `Db.Row` instances (or `{fields: row}` wrappers).
Postgres returned raw pg row objects, so any code written against the `row.fields.x`
contract broke, and `className` models were never constructed. Now wraps to match,
with the same `className` → `rowClass.newRow` path and the same plain-object
fallback the Sqlite adapter uses.

---

## Verification

Everything below was run against live servers, not mocks.

**Stack:** MariaDB 10.11, PostgreSQL 16, better-sqlite3 (real file at
`/tmp/qbixtest.db`), PHP 8.3, `Qbix/Platform` with all plugin submodules, Hebrews
app installed via `scripts/Q/install.php --plugins --app` (82 tables), re-verified
on a from-scratch install into a fresh database.

| Suite | Result | Covers |
|---|---|---|
| `tests/dbtest.js` | **39 / 39** | MySQL construction + live execution |
| `tests/dbtest.php` | **31 / 31** | PHP parity reference |
| `tests/adaptertest.js` | **34 / 34** | **live SQLite + live Postgres**, connect / CREATE / INSERT / SELECT / WHERE / UPDATE / DELETE round-trips on both |
| `tests/basetest.js` | **15 / 15** | construction through the Sqlite adapter (see scope note above) |
| `tests/repro.js` | **3 / 3** | the exact paths from the original bug report |

`Streams.Message.post` — the call in your stack trace — returns an ordinal.

JS construction output is now character-identical to PHP's apart from parameter
naming (`_criteria_N` vs `_where_N`), which was already divergent.

All 11 files under `classes/Db/` pass `node --check`; the PHP files pass `php -l`.

### Running the tests

Copy `tests/*` into your app's `scripts/` directory (they resolve the platform via
`Q.inc`), then:

```sh
node scripts/dbtest.js       # MySQL; exits non-zero on failure
php  scripts/dbtest.php      # PHP reference
node scripts/adaptertest.js  # SQLite + Postgres
node scripts/basetest.js
```

`adaptertest.js` needs `better-sqlite3` and `pg` installed (see below), a reachable
Postgres with a `qbix`/`qbixpass` superuser and a `qbixtest` database, and write
access to `/tmp/qbixtest.db`. Adjust the two `Db.setConnection` calls at the top for
your environment. It creates and drops its own `tst_item` table in both.

`dbtest.js` writes and deletes rows under `publisherId = 'jstest'`; `dbtest.php`
uses `'dbtest'`. Both clean up. `dbtest.js` posts one real message to an existing
stream, incrementing that stream's `messageCount` — point it at a throwaway stream
if that matters.

---

## Two things to fix on your side

### `better-sqlite3` and `pg` are undeclared dependencies

`Db/Sqlite.js` requires `better-sqlite3` and `Db/Postgres.js` requires `pg`, but
neither is in `platform/package.json`. I installed them to test. They should be
added — as `optionalDependencies` if you do not want every install pulling a native
build:

```json
"optionalDependencies": {
    "better-sqlite3": "^11.0.0",
    "pg": "^8.11.0"
}
```

I did not edit `package.json`, since whether these belong in `dependencies` or
`optionalDependencies` is your call.

### Duplicated criteria builders

`_criteria_expression` in the base class and `criteria_internal` in the Mysql
adapter are near-duplicates that have already drifted: the base has a `!=` prefix
hack and duck-typed range detection the adapter lacks; the adapter has
`/\W/`-suffix expression handling the base lacks. I fixed the bugs in both rather
than unify them, since collapsing them is a behavioural change better made
deliberately.
