const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert/strict');
const source = fs.readFileSync(__dirname + '/AI_YouTube_RealCheck.js', 'utf8');

async function test() {
  const values = new Map(), calls = [], logs = [], attempts = new Map();
  let active = 0, maximumActive = 0;
  const app = '<title>ChatGPT</title><script>window.__reactRouterContext={}</script>';
  const premium = '<title>YouTube Premium</title><script>var ytInitialData={};</script>';
  let goodBlocked = false;
  const fixtures = {
    good: () => ({ chat: goodBlocked ? 'unsupported_country' : app, yt: premium }),
    blocked: () => ({ chat: 'unsupported_country', yt: premium }),
    noyt: () => ({ chat: app, yt: 'YouTube Premium is not available in your country' }),
    broken: () => ({ error: true }),
    tlsError: () => ({ thrown: { code: 'TLS_HANDSHAKE_FAILED', message: 'TLS failed https://example.com/?token=private-value password=private-password' } }),
    stringError: () => ({ thrown: 'ECONNRESET https://example.com/?token=private-value' }),
    retrySuccess: () => ({ chat: app, yt: premium, retry: true }),
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
      wait: async delay => assert.equal(delay, 500),
      http: { get: async o => {
        active++;
        maximumActive = Math.max(maximumActive, active);
        await new Promise(resolve => setImmediate(resolve));
        try {
        calls.push(o);
        assert.equal(o.node, o['policy-descriptor']);
        const f = fixtures[o.node.slice('descriptor:'.length)]();
        const attemptKey = o.node + o.url;
        attempts.set(attemptKey, (attempts.get(attemptKey) || 0) + 1);
        if (f.error) throw new Error('network failure');
        if (f.thrown) throw f.thrown;
        if (f.retry && attempts.get(attemptKey) === 1) throw new Error('transient failure');
        assert(!o.url.includes('cdn-cgi/trace'), '地区信息不能充当解锁检测');
        if (o.url.includes('youtube.com')) {
          assert.equal(o.headers['Accept-Language'], 'en-US,en;q=0.9');
          return { statusCode: 200, body: f.yt };
        }
        assert.equal(o.url, 'https://chatgpt.com/');
        assert(o.headers['User-Agent'].includes('Safari/604.1'));
        assert(o.headers.Accept.includes('text/html'));
        return { statusCode: f.status || 200, headers: { 'content-type': 'text/html' }, body: f.chat };
        } finally { active--; }
      } }
    }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const proxies = Object.keys(fixtures).map(id => ({ id, name: '美国 GPT 解锁 同名节点', _subName: 'sample' }));
  // 旧版本错误的成功缓存不允许混入新输出。
  values.set('yc-unlock:result:v3:' + context.ProxyUtils.hex_md5('descriptor:regionOnly'), { ok: true, time: Date.now() });
  values.set('yc-unlock:result:v4:' + context.ProxyUtils.hex_md5('descriptor:regionOnly'), { ok: true, time: Date.now() });
  await assert.rejects(context.operator(proxies), /先在 Loon/);
  assert.equal(calls.length, 0);
  context.$script.name = '立即检测解锁节点';
  let output = await context.operator(proxies);
  assert.deepEqual(Array.from(output, p => p.id), ['good', 'retrySuccess']);
  assert.equal(values.size, proxies.length + 2);
  assert(logs.some(l => l.includes('网站验证')));
  assert(logs.some(l => l.includes('汇总=')));
  assert(logs.some(l => l.includes('原因统计=') && l.includes('TLS_HANDSHAKE_FAILED') && l.includes('ECONNRESET')));
  assert(logs.some(l => l.includes('进度=')));
  assert(!logs.some(l => /private-value|private-password/.test(l)), '错误日志不能泄露请求地址中的凭据');
  assert.equal(attempts.get('descriptor:retrySuccesshttps://chatgpt.com/'), 2);
  assert.equal(attempts.get('descriptor:brokenhttps://chatgpt.com/'), 2, '最多重试一次');
  assert(maximumActive <= 8, '四节点并发，每节点最多两项请求');
  assert.match(output[0].name, /^\[实测\]/);
  assert(!proxies[0].name.startsWith('[实测]'));
  context.$script.name = 'Sub-Store Core';
  const before = calls.length;
  output = await context.operator(proxies);
  assert.deepEqual(Array.from(output, p => p.id), ['good', 'retrySuccess']);
  assert.equal(calls.length, before, '预览不能重新检测');
  for (const v of values.values()) v.time = Date.now() - 3600001;
  await assert.rejects(context.operator(proxies), /没有有效检测结果/);
  assert.equal(calls.length, before);
  context.$script.name = '实测解锁后台检测';
  await context.operator(proxies);
  goodBlocked = true;
  output = await context.operator(proxies);
  assert.deepEqual(Array.from(output, p => p.id), ['retrySuccess']);
  context.$script.name = 'Sub-Store Core';
  output = await context.operator(proxies);
  assert.deepEqual(Array.from(output, p => p.id), ['retrySuccess']);
  await assert.rejects(context.operator(proxies.filter(p => p.id === 'broken')), /没有有效检测结果/);
  context.$substore.env.isLoon = false;
  await assert.rejects(context.operator(proxies), /Loon/);
  assert(calls.every(o => !o.url.includes('kelee.one')));
  console.log('PASS: 响应判定、v3/v4缓存隔离、错误详情与脱敏、连接异常仅重试一次、重试恢复、请求头、进度与原因统计、后台/只读分离、过期与失效排除。');
}
test().catch(error => { console.error(error); process.exitCode = 1; });
