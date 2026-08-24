Copy these into your app's scripts/ directory (they resolve the platform via
Q.inc), then run:

  node scripts/repro.js           3   the three paths from the original bug report
  node scripts/dbtest.js         53   construction, live execution, after-clauses,
                                      parameter substitution, PHP/JS parity helpers
  php  scripts/dbtest.php        37   PHP parity reference, parameter substitution,
                                      limit(0), normalize/hashCode/hash
  node scripts/basetest.js       15   construction through the Sqlite adapter
  node scripts/adaptertest.js    34   live SQLite + live Postgres round-trips
  node scripts/vectortest.js     50   Db.Vector, SQL gen for all 3, version gate,
                                      method-name AND vector-prefix parity,
                                      live pgvector + live sqlite-vec
  php  scripts/vectortest.php    42   the same on the PHP side, plus a check that
                                      every added method exists on all 3 adapters
  node scripts/e2etest.js        15   768-dim vectors through the Db layer
  node scripts/mariadbvectortest.js
                                 11   live MariaDB 11.8: VECTOR(768), HNSW index
  node scripts/crossvectortest.js
                                 58   CROSS-ENGINE SUITE: one battery run
                                      identically against MariaDB, pgvector and
                                      sqlite-vec; index-drift checks; distance-
                                      VALUE parity for both metrics; and
                                      vectorIndexCreate parity across adapters
  php  scripts/integrationtest.php
                                 13   MODEL LAYER: generated Base class,
                                      ->save() / ->retrieve() / ->remove(),
                                      Model::select()->vectorNearestTo()->fetchDbRows(),
                                      dimension-mismatch guard
  node scripts/integrationtest.js
                                  8   the same, in JS
  php  scripts/migrationtest.php
                                  5   THE install.php PATH: a schema file adds a
                                      VECTOR column, models.php generates the
                                      class, save + vectorNearestTo both work

                                341   total on MariaDB 11.8
                                287   total on MariaDB 10.11 (the vector suites
                                      skip the MariaDB engine; the gate stays shut)

The four that matter most when you change anything:
  crossvectortest.js  -- the engines return the same ANSWERS, the same distance
                         VALUES, and respond to the same schema calls
  integrationtest.*   -- it works the way an app actually calls it, and a
                         dimension mismatch is refused rather than silently wrong
  migrationtest.php   -- a vector column added by install.php is fully usable
  dbtest.*            -- PHP and JS agree on dates, limits, and normalize

Unavailable engines are reported as SKIP, not failure, so crossvectortest runs
anywhere without environment special-casing.

Requirements
  dbtest.*            a MySQL/MariaDB connection named 'Streams' (your app's own)
  adaptertest         better-sqlite3; pg + a reachable Postgres
                      (user qbix / qbixpass, database qbixtest)
  vectortest          the above, plus pgvector in qbixtest and sqlite-vec
  e2etest             same as vectortest
  mariadbvectortest   MariaDB 11.7 or later
  crossvectortest     any subset of the three; missing ones are skipped
  migrationtest.php   MariaDB 11.7+, and the hebrews_note table created by the
                      example migrations in ../examples/ (see the main README)
  integrationtest.*   MariaDB 11.7+, a 'Hebrews' connection, and a table
                      hebrews_document with a VECTOR(768) column -- see the
                      "Using it" section of the main README for the DDL, then
                      run: php scripts/Q/models.php --all

Install the optional native drivers with:
  npm install --include=optional

Every vector method starts with "vector", so autocomplete groups them:

  $db->vectorIndexCreate('docs', 'embedding', 768, array('metric' => 'cosine'));
  $db->vectorIndexMetric('docs', 'embedding');
  $db->vectorIndexDrop('docs', 'embedding');

  $q->vectorNearestTo('embedding', Db::vector($e), array('limit' => 10));
  $q->vectorMetricsSupported();

nearestTo() remains as a short alias of vectorNearestTo() for fluent chains;
a test asserts the two produce identical SQL.

Build the index for the metric you search with. On SQLite the base table holds
the vector as a BLOB and the vec0 sidecar is an index kept in step by triggers;
vectorNearestTo() refuses a metric mismatch rather than answering in wrong units.

Note on timestamps: Db.fromDate / Db.fromDateTime return MILLISECONDS in JS and
SECONDS in PHP. That is intentional -- JS timestamps are ms. A test pins the JS
value at exactly 1000x the PHP one so the relationship stays explicit.

Adjust the Db.setConnection calls at the top of adaptertest / vectortest /
e2etest / crossvectortest for your environment. They create and drop their own
tables. dbtest.js writes rows under publisherId='jstest'; dbtest.php uses
'dbtest'; dbtest.js posts one real message to an existing stream.

All suites were run against MariaDB 11.8.3 AND MariaDB 10.11, with
PostgreSQL 16 + pgvector and sqlite-vec live in both passes.
