const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert/strict');
const source = fs.readFileSync(__dirname + '/AI_YouTube_RealCheck.js', 'utf8');

async function test() {
  const values = new Map(), calls = [], logs = [];
  const app = '<title>ChatGPT</title><script>window.__reactRouterContext={}</script>';
  const premium = '<title>YouTube Premium</title><script>var ytInitialData={};</script>';
  let goodBlocked = false;
  const fixtures = {
    good: () => ({ chat: goodBlocked ? 'unsupported_country' : app, yt: premium }),
    blocked: () => ({ chat: 'unsupported_country', yt: premium }),
    noyt: () => ({ chat: app, yt: 'YouTube Premium is not available in your country' }),
    broken: () => ({ error: true }),
    malformed: () => ({ chat: 'An error occurred', yt: premium }),
    challenge: () => ({ chat: '<title>Just a moment...</title><script>challenge-platform</script>', yt: premium }),
    ytchallenge: () => ({ chat: app, yt: '<title>Just a moment...</title>' }),
    html403: () => ({ chat: app, status: 403, yt: premium }),
    regionOnly: () => ({ chat: 'loc=US\n', yt: premium }),
    yterror: () => ({ chat: app, yt: 'Server error, please try again' })
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
      env: { isLoon: true }, info: text => logs.push(text),
      http: { get: async o => {
        calls.push(o);
        assert.equal(o.node, o['policy-descriptor']);
        const f = fixtures[o.node.slice('descriptor:'.length)]();
        if (f.error) throw new Error('network failure');
        assert(!o.url.includes('cdn-cgi/trace'), '地区信息不能充当解锁检测');
        if (o.url.includes('youtube.com')) {
          assert.equal(o.headers['Accept-Language'], 'en-US,en;q=0.9');
          return { statusCode: 200, body: f.yt };
        }
        assert.equal(o.url, 'https://chatgpt.com/');
        return { statusCode: f.status || 200, headers: { 'content-type': 'text/html' }, body: f.chat };
      } }
    }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const proxies = Object.keys(fixtures).map(id => ({ id, name: '美国 GPT 解锁 同名节点', _subName: 'sample' }));
  // 旧版本错误的成功缓存不允许混入新输出。
  values.set('yc-unlock:result:v3:' + context.ProxyUtils.hex_md5('descriptor:regionOnly'), { ok: true, time: Date.now() });
  await assert.rejects(context.operator(proxies), /先在 Loon/);
  assert.equal(calls.length, 0);
  context.$script.name = '立即检测解锁节点';
  let output = await context.operator(proxies);
  assert.deepEqual(Array.from(output, p => p.id), ['good']);
  assert.equal(values.size, proxies.length + 1);
  assert(logs.some(l => l.includes('网站验证')));
  assert(logs.some(l => l.includes('汇总=')));
  assert.match(output[0].name, /^\[实测\]/);
  assert(!proxies[0].name.startsWith('[实测]'));
  context.$script.name = 'Sub-Store Core';
  const before = calls.length;
  output = await context.operator(proxies);
  assert.deepEqual(Array.from(output, p => p.id), ['good']);
  assert.equal(calls.length, before, '预览不能重新检测');
  for (const v of values.values()) v.time = Date.now() - 3600001;
  await assert.rejects(context.operator(proxies), /没有有效检测结果/);
  assert.equal(calls.length, before);
  context.$script.name = '实测解锁后台检测';
  await context.operator(proxies);
  goodBlocked = true;
  await assert.rejects(context.operator(proxies), /没有节点同时通过/);
  context.$script.name = 'Sub-Store Core';
  await assert.rejects(context.operator(proxies), /没有有效检测结果/);
  context.$substore.env.isLoon = false;
  await assert.rejects(context.operator(proxies), /Loon/);
  assert(calls.every(o => !o.url.includes('kelee.one')));
  console.log('PASS: 错误页200、验证页200、HTTP403、单项受限、地区假阳性、旧缓存污染、网络失败、重名出口、后台/只读分离、过期与失效排除、诊断汇总。');
}
test().catch(error => { console.error(error); process.exitCode = 1; });
