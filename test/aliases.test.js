const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const { GraphDB } = require('../lib/graph-db');
const { MemoryDB } = require('../lib/memory-db');
const { MemoryQueries } = require('../lib/memory-queries');

function tmpPaths() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    graph: path.join(os.tmpdir(), `gm-aliases-graph-${suffix}.db`),
    mem: path.join(os.tmpdir(), `gm-aliases-mem-${suffix}.db`),
    proj: path.join(os.tmpdir(), `gm-aliases-proj-${suffix}`),
  };
}

function cleanup(p) {
  for (const f of [p.graph, p.graph + '-wal', p.graph + '-shm', p.mem, p.mem + '-wal', p.mem + '-shm']) {
    try { fs.unlinkSync(f); } catch {}
  }
  try { fs.rmSync(p.proj, { recursive: true, force: true }); } catch {}
}

function writeProject(projDir, files) {
  fs.mkdirSync(projDir, { recursive: true });
  fs.writeFileSync(path.join(projDir, 'package.json'), '{"name":"fixture"}');
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(projDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

function runScan(p, projName) {
  const script = path.join(__dirname, '..', 'scripts', 'scan.js');
  execSync(
    `node ${script} --dir ${p.proj} --name ${projName} --db ${p.graph} --memory-db ${p.mem} --seed-aliases`,
    { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
}

function runResolve(p, args) {
  const script = path.join(__dirname, '..', 'scripts', 'query.js');
  return execSync(
    `node ${script} --resolve ${args} --db ${p.graph} --memory-db ${p.mem}`,
    { encoding: 'utf-8' }
  );
}

describe('alias seeding + resolution', () => {
  let p;

  beforeEach(() => {
    p = tmpPaths();
    writeProject(p.proj, {
      'lib/server.js': [
        'function startServer() {}',
        'function stopServer() {}',
        'function getStatus() {}',
        'module.exports = { startServer, stopServer, getStatus };',
      ].join('\n'),
      'lib/util.js': 'function helper() {}\nmodule.exports = { helper };',
    });
  });

  afterEach(() => cleanup(p));

  it('seeds project-level alias', () => {
    runScan(p, 'fixturepkg');
    const mem = new MemoryDB(p.mem);
    const aliases = mem.db.prepare('SELECT * FROM aliases WHERE project = ?').all('fixturepkg');
    const projectAlias = aliases.find(a => a.alias === 'fixturepkg' && a.file === null);
    assert.ok(projectAlias, 'project-level alias should exist');
    mem.close();
  });

  it('seeds file-stem alias for files with 3+ exported functions', () => {
    runScan(p, 'fixturepkg');
    const mem = new MemoryDB(p.mem);
    const serverAlias = mem.db.prepare(
      'SELECT * FROM aliases WHERE project = ? AND alias = ?'
    ).get('fixturepkg', 'server');
    assert.ok(serverAlias, 'server.js file stem alias should exist (3+ exports)');
    assert.ok(serverAlias.file && serverAlias.file.includes('server.js'));

    // util.js has only one export — should NOT have a file-stem alias
    const utilAlias = mem.db.prepare(
      'SELECT * FROM aliases WHERE project = ? AND alias = ?'
    ).get('fixturepkg', 'util');
    assert.strictEqual(utilAlias, undefined, 'util.js with 1 export should not get file-stem alias');
    mem.close();
  });

  it('seeds per-function aliases as "<project> <functionName>" lowercased', () => {
    runScan(p, 'fixturepkg');
    const mem = new MemoryDB(p.mem);
    const fnAlias = mem.db.prepare(
      'SELECT * FROM aliases WHERE project = ? AND alias = ?'
    ).get('fixturepkg', 'fixturepkg startserver');
    assert.ok(fnAlias, 'fn alias "fixturepkg startserver" should exist');
    assert.ok(fnAlias.file && fnAlias.file.includes('server.js'));
    mem.close();
  });

  it('re-scan does not double-insert (INSERT OR IGNORE)', () => {
    runScan(p, 'fixturepkg');
    const mem1 = new MemoryDB(p.mem);
    const count1 = mem1.db.prepare('SELECT COUNT(*) as n FROM aliases').get().n;
    mem1.close();

    runScan(p, 'fixturepkg');
    const mem2 = new MemoryDB(p.mem);
    const count2 = mem2.db.prepare('SELECT COUNT(*) as n FROM aliases').get().n;
    mem2.close();

    assert.strictEqual(count1, count2, 'alias count should not change on re-scan');
  });

  it('--resolve project-name returns the project-level alias', () => {
    runScan(p, 'fixturepkg');
    const out = runResolve(p, 'fixturepkg');
    assert.match(out, /fixturepkg\tfixturepkg/);
  });

  it('--resolve "<project> <funcname>" returns the function alias', () => {
    runScan(p, 'fixturepkg');
    const out = runResolve(p, '"fixturepkg startserver"');
    assert.match(out, /server\.js/);
  });

  it('--resolve ambiguous token returns fuzzy matches across projects', () => {
    runScan(p, 'fixturepkg');
    const out = runResolve(p, 'serv');
    const lines = out.trim().split('\n').filter(Boolean);
    assert.ok(lines.length >= 1, 'fuzzy resolve should return at least one match');
  });
});
