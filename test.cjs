const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert/strict');
const source = fs.readFileSync(__dirname + '/AI_YouTube_RealCheck.js', 'utf8');

async function test() {
  const values = new Map();
  const calls = [];
  let goodRegion = 'US';
  const fixtures = {
    good: () => ({ region: goodRegion, youtube: true }),
    blocked: () => ({ region: 'CN', youtube: true }),
    noyt: () => ({ region: 'US', youtube: false }),
    broken: () => ({ error: true }),
    malformed: () => ({ region: null, youtube: true })
  };
  const context = {
    Date, Promise, console,
    $script: { name: 'Sub-Store Core' },
    scriptResourceCache: { get: k => values.get(k), set: (k,v) => values.set(k,v) },
    ProxyUtils: {
      produce: ([p], platform) => { assert.equal(platform, 'Loon'); return 'descriptor:' + p.id; },
      hex_md5: s => crypto.createHash('md5').update(s).digest('hex')
    },
    $substore: {
      env: { isLoon: true }, info() {},
      http: { get: async o => {
        calls.push(o);
        assert.equal(o.node, o['policy-descriptor']);
        const fixture = fixtures[o.node.slice('descriptor:'.length)]();
        if (fixture.error) throw new Error('network failure');
        if (o.url.includes('youtube.com')) return {
          statusCode: 200,
          body: fixture.youtube ? 'YouTube Premium' : 'Premium is not available in your country'
        };
        if (o.url.includes('cdn-cgi/trace')) return {
          statusCode: 200,
          body: fixture.region ? 'ip=example\nloc=' + fixture.region + '\n' : 'invalid trace'
        };
        assert.equal(o['auto-redirect'], false);
        return { statusCode: 308, headers: { 'content-type': 'text/html' }, body: '' };
      } }
    }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const proxies = Object.keys(fixtures).map(id => ({ id, name: '同名节点', _subName: 'sample' }));
  await assert.rejects(context.operator(proxies), /先在 Loon/);
  assert.equal(calls.length, 0, '未初始化的预览不得发起检测');
  context.$script.name = '立即检测解锁节点';
  let output = await context.operator(proxies);
  assert.deepEqual(Array.from(output, p => p.id), ['good']);
  assert.match(output[0].name, /^\[实测\]/);
  assert.equal(proxies[0].name, '同名节点');
  assert.equal(values.size, proxies.length, '通过和失败结果都应被记录');
  context.$script.name = 'Sub-Store Core';
  const before = calls.length;
  output = await context.operator(proxies);
  assert.deepEqual(Array.from(output, p => p.id), ['good']);
  assert.equal(calls.length, before, '预览仅可读取缓存');
  for (const v of values.values()) v.time = Date.now() - 3600001;
  await assert.rejects(context.operator(proxies), /没有有效检测结果/);
  assert.equal(calls.length, before, '缓存过期的预览也不能触发全量检测');
  context.$script.name = '实测解锁后台检测';
  await context.operator(proxies);
  goodRegion = 'CN';
  await assert.rejects(context.operator(proxies), /没有节点同时通过/);
  context.$script.name = 'Sub-Store Core';
  await assert.rejects(context.operator(proxies), /没有有效检测结果/);
  context.$substore.env.isLoon = false;
  await assert.rejects(context.operator(proxies), /Loon/);
  assert(calls.every(o => !o.url.includes('kelee.one')), '不得依赖下载远程检测 JS');
  console.log('PASS: 冷缓存、手动后台、定时后台、出口隔离、双项筛选、失败记录、只读预览、过期排除、失效节点移除、环境检查。');
}
test().catch(error => { console.error(error); process.exitCode = 1; });
