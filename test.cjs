const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert/strict');
const source = fs.readFileSync(__dirname + '/AI_YouTube_RealCheck.js', 'utf8');

async function test() {
  const values = new Map(), durable = new Map(), calls = [], logs = [], attempts = new Map(), displays = [];
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
      done: value => displays.push(value),
      read: key => durable.get(key), write: (value, key) => durable.set(key, value),
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
  const proxies = Object.keys(fixtures).map(id => ({ id, server: id + '.invalid', port: 443, type: 'ss', name: '美国 GPT 解锁 同名节点', _subName: 'sample' }));
  // 旧版本错误的成功缓存不允许混入新输出。
  values.set('yc-unlock:result:v3:' + context.ProxyUtils.hex_md5('descriptor:regionOnly'), { ok: true, time: Date.now() });
  values.set('yc-unlock:result:v4:' + context.ProxyUtils.hex_md5('descriptor:regionOnly'), { ok: true, time: Date.now() });
  await assert.rejects(context.operator(proxies), /新增节点/);
  assert.equal(calls.length, 0);
  context.$script.name = '立即检测解锁节点';
  let output = await context.operator(proxies);
  assert.deepEqual(Array.from(output, p => p.id), ['good', 'retrySuccess']);
  assert.equal(durable.size, proxies.length);
  context.$substore.done();
  assert.match(displays.at(-1).content, /通过：2/);
  assert.match(displays.at(-1).content, /本次新检测：/);
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
  // 重启并经过很久仍然使用长期记录，不重新检测。
  for (const [key, raw] of durable) {
    const record = JSON.parse(raw); record.time = 1; durable.set(key, JSON.stringify(record));
  }
  context.$script.name = '立即检测解锁节点';
  goodBlocked = true;
  output = await context.operator(proxies);
  assert.deepEqual(Array.from(output, p => p.id), ['good', 'retrySuccess']);
  assert.equal(calls.length, before, '重复手动执行也不能重测旧节点');
  context.$substore.done();
  assert.match(displays.at(-1).content, /本次新检测：0/);
  assert.equal(displays.length, 2, '完成回调只能调用一次');
  context.$script.name = '实测解锁后台检测';
  output = await context.operator(proxies);
  assert.equal(calls.length, before, '旧定时入口不能再检测');
  const renamed = proxies.map(p => ({ ...p, name: '新名字', _subName: '新显示归属' }));
  await context.operator(renamed);
  assert.equal(calls.length, before, '改名不应该重测');
  // 同一旧定时入口遇到新节点，也只能读取，不能发起检测。
  fixtures.added = () => ({ chat: app, yt: premium });
  const added = { id: 'added', server: 'added.invalid', port: 443, type: 'ss', name: '新增节点' };
  await context.operator([...proxies, added]);
  assert.equal(calls.length, before);
  context.$script.name = '立即检测解锁节点';
  output = await context.operator([...proxies, added]);
  assert.equal(calls.length, before + 2, '新增节点只新增两项服务检测');
  assert.deepEqual(Array.from(output, p => p.id), ['good', 'retrySuccess', 'added']);
  // 删除的节点不会继续混入输出。
  context.$script.name = 'Sub-Store Core';
  output = await context.operator([added]);
  assert.deepEqual(Array.from(output, p => p.id), ['added']);
  // 一次检测失败也长期保留，不会每次预览/手动点击再试。
  await assert.rejects(context.operator(proxies.filter(p => p.id === 'broken')), /没有通过节点/);
  // 升级接收已有 v4 严格判定，避免把已经检测过的节点重测一次。
  fixtures.legacy = () => { throw new Error('不应发起检测'); };
  const legacy = { id: 'legacy', server: 'legacy.invalid', port: 443, type: 'ss', name: '旧结果' };
  values.set('yc-unlock:result:v4:' + context.ProxyUtils.hex_md5('descriptor:legacy'), {
    ok: true, state: 'passed', time: 1, chatgpt: { state: 'passed' }, youtube: { state: 'passed' }
  });
  const preMigration = calls.length;
  output = await context.operator([legacy]);
  assert.deepEqual(Array.from(output, p => p.id), ['legacy']);
  values.clear();
  output = await context.operator([legacy]);
  assert.equal(calls.length, preMigration, '迁移后清空旧缓存不会丢长期结果');
  context.$substore.env.isLoon = false;
  await assert.rejects(context.operator(proxies), /Loon/);
  assert(calls.every(o => !o.url.includes('kelee.one')));
  console.log('PASS: 严格响应判定、请求错误与脱敏、有限重试、长期结果不过期、重复手动不重测、旧定时不检测、新增仅测新增、改名不重测、删除不混入、迁移旧结果、清缓存不丢记录。');
}
test().catch(error => { console.error(error); process.exitCode = 1; });
