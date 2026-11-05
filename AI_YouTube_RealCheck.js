/* Sub-Store「脚本操作 → 内容」；仅支持 Loon 内运行的后端。
 * 参考可莉 NodeUnlockDetection.js 的逐节点检测思路。
 * 参考作者：XIAO_KOP、keywos、dcpengx。
 * 修正：地区判断、验证页面、非目标 HTML 均不能作为支持结果。
 * 后台检测版：不下载远程 JS，不依据节点名称判断。
 * Loon 脚本标签“实测解锁后台检测”负责扫描；只在手动入口检测尚无记录的节点；结果长期保存，预览和旧定时入口均不检测。
 */
async function operator(proxies = []) {
  const $ = $substore;
  if (!$.env || !$.env.isLoon) throw new Error('请使用 Loon 内运行的 Sub-Store 后端');
  const legacyCache = typeof scriptResourceCache === 'undefined' ? null : scriptResourceCache;
  const entry = typeof $script !== 'undefined' ? $script.name : '未取得Loon脚本标签';
  const scanning = entry === '立即检测解锁节点';
  const started = Date.now();
  const browserUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Mobile/15E148 Safari/604.1';
  $.info('[实测解锁] 版本=v6.1，入口=' + entry + '，模式=' + (scanning ? '仅检测新增节点' : '读取长期结果'));
  const passed = new Array(proxies.length).fill(false);
  const summary = { passed: 0, unsupported: 0, error: 0, missing: 0, reused: 0, migrated: 0, tested: 0 };
  const reasons = {};
  let cursor = 0, completed = 0;
  // 官方后台入口以 $.done() 结束，没有提供 Generic 弹窗内容。
  // 仅在手动扫描上下文补上最终显示结果，HTTP 导出响应不改动。
  if (scanning && typeof $.done === 'function') {
    const finish = $._ycUnlockOriginalDone || $.done.bind($);
    $._ycUnlockOriginalDone = finish;
    $.done = function () {
      return finish({
        title: '节点筛选执行结束',
        content: '已处理：' + completed + '/' + proxies.length +
          '\n通过：' + summary.passed +
          '\n明确受限：' + summary.unsupported +
          '\n检测异常：' + summary.error +
          '\n本次新检测：' + summary.tested +
          '\n复用记录：' + summary.reused +
          '\n结果长期保存；检测异常不代表不支持。'
      });
    };
  }
  function errorText(error, node) {
    let raw;
    if (typeof error === 'string') raw = error;
    else if (error && typeof error === 'object') {
      raw = [error.name, error.code, error.errorCode, error.message, error.error,
        error.localizedDescription, error.errorDescription, error.error_description, error.description]
        .filter(value => typeof value === 'string' || typeof value === 'number').join(' | ');
    }
    raw = raw || '未提供错误信息';
    if (node) raw = raw.split(node).join('[节点描述已隐藏]');
    return raw.replace(/https?:\/\/[^\s<>"']+/gi, '[URL]')
      .replace(/(?:ghp_|github_pat_)[A-Za-z0-9_]+/g, '[令牌已隐藏]')
      .replace(/((?:token|password|authorization|secret|cookie)\s*[=:]\s*)[^\s,;]+/gi, '$1[已隐藏]')
      .replace(/[\r\n]+/g, ' ').slice(0, 240);
  }
  async function get(node, url, extra = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await $.http.get({ url, timeout: 10000, ...extra, node, 'policy-descriptor': node });
      } catch (error) {
        if (attempt === 1) throw new Error(errorText(error, node));
        await $.wait(500);
      }
    }
  }
  function status(response) {
    return Number(response.statusCode || response.status);
  }
  function state(kind, reason) { return { state: kind, reason }; }
  function challenged(body) {
    return /<title[^>]*>\s*(just a moment|attention required)|cf-chl-|challenge-platform|verify (that )?you are human|unusual traffic|consent\.youtube\.com/i.test(body);
  }
  async function chatgpt(node) {
    const start = Date.now();
    try {
      const response = await get(node, 'https://chatgpt.com/', {
        headers: { 'Accept-Language': 'en-US,en;q=0.9', 'User-Agent': browserUA,
          Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8' }
      });
      const body = typeof response.body === 'string' ? response.body : '';
      if (challenged(body)) return state('error', '网站验证拦截');
      if (/unsupported_country|country.{0,30}not supported|region.{0,30}not supported/i.test(body)) return state('unsupported', '地区限制');
      if (status(response) !== 200) return state('error', 'HTTP ' + status(response));
      if (/ChatGPT/i.test(body) && /__NEXT_DATA__|__next|__reactRouterContext|__reactRouterManifest|oaistatic\.com|chatgpt\.com\/cdn\/assets/i.test(body)) return state('passed', '识别到ChatGPT网页');
      return state('error', '未识别到ChatGPT网页');
    } catch (error) { return state('error', '请求异常 ' + (Date.now() - start) + 'ms：' + errorText(error, node)); }
  }
  async function youtube(node) {
    const start = Date.now();
    try {
      const response = await get(node, 'https://www.youtube.com/premium?hl=en', {
        headers: {
          'Accept-Language': 'en-US,en;q=0.9',
          'User-Agent': browserUA
        }
      });
      const body = typeof response.body === 'string' ? response.body : '';
      if (challenged(body)) return state('error', '网站验证或同意页面');
      if (status(response) !== 200) return state('error', 'HTTP ' + status(response));
      if (/Premium is not available in your country|Premium is not available in your region|Premium is unavailable in your country/i.test(body)) return state('unsupported', 'Premium地区限制');
      if (/ytInitialData/.test(body) && /YouTube Premium/.test(body)) return state('passed', '识别到Premium网页');
      return state('error', '未识别到Premium网页');
    } catch (error) { return state('error', '请求异常 ' + (Date.now() - start) + 'ms：' + errorText(error, node)); }
  }
  async function check(proxy, index) {
    let node;
    try { node = ProxyUtils.produce([proxy], 'Loon'); }
    catch (_) { summary.error++; $.info('[实测解锁] ' + proxy.name + '：节点转换失败'); return; }
    if (typeof node !== 'string' || !node.trim()) { summary.error++; $.info('[实测解锁] ' + proxy.name + '：当前 Loon 不支持此节点描述'); return; }
    // 名称、订阅归属、显示元数据不改变出口配置的身份。
    const identity = Object.fromEntries(Object.entries(proxy)
      .filter(([k]) => !/^(name|collectionName|subName|id|_.*)$/i.test(k))
      .sort(([a], [b]) => a.localeCompare(b)));
    const key = '#yc-unlock:once:v1:' + ProxyUtils.hex_md5(JSON.stringify(identity));
    let saved;
    const raw = $.read(key);
    if (raw != null && raw !== '') {
      try { saved = typeof raw === 'string' ? JSON.parse(raw) : raw; }
      catch (_) { throw new Error('长期检测记录损坏，停止处理，未自动重测'); }
      if (!saved || saved.schema !== 1 || !['passed', 'unsupported', 'error'].includes(saved.state)) {
        throw new Error('长期检测记录格式错误，停止处理，未自动重测');
      }
    }
    // 接收仍在旧缓存中的同一套严格网页检测记录，避免升级后再测一次。
    if (!saved && legacyCache) {
      for (const version of ['v5', 'v4']) {
        const old = legacyCache.get('yc-unlock:result:' + version + ':' + ProxyUtils.hex_md5(node));
        if (old && ['passed', 'unsupported', 'error'].includes(old.state)
          && old.chatgpt && old.youtube) {
          saved = { ...old, schema: 1, migratedFrom: version };
          $.write(JSON.stringify(saved), key);
          summary.migrated++;
          break;
        }
      }
    }
    if (saved) {
      passed[index] = saved.ok === true && saved.state === 'passed';
      summary[passed[index] ? 'passed' : saved.state === 'unsupported' ? 'unsupported' : 'error']++;
      summary.reused++;
      return;
    }
    if (!scanning) { summary.missing++; return; }
    summary.tested++;
    const results = await Promise.all([chatgpt(node), youtube(node)]);
    const ok = results.every(item => item.state === 'passed');
    const kind = ok ? 'passed' : results.some(item => item.state === 'error') ? 'error' : 'unsupported';
    passed[index] = ok;
    summary[kind]++;
    for (let i = 0; i < results.length; i++) {
      if (results[i].state === 'error') {
        const label = (i ? 'YouTube：' : 'ChatGPT：') + results[i].reason.replace(/\d+ms/g, '');
        reasons[label] = (reasons[label] || 0) + 1;
      }
    }
    $.write(JSON.stringify({ schema: 1, ok, state: kind, time: Date.now(), chatgpt: results[0], youtube: results[1] }), key);
    $.info('[实测解锁] ' + proxy.name + '：ChatGPT=' + results[0].state + '(' + results[0].reason + ')；YouTube=' + results[1].state + '(' + results[1].reason + ')');
  }
  async function worker() {
    while (cursor < proxies.length) {
      const index = cursor++;
      await check(proxies[index], index);
      completed++;
      if (scanning && (completed % 10 === 0 || completed === proxies.length)) {
        $.info('[实测解锁] 进度=' + completed + '/' + proxies.length + '，已用=' + Math.round((Date.now() - started) / 1000) + '秒');
      }
    }
  }
  if (scanning) $.info('[实测解锁] 开始检测 ' + proxies.length + ' 个节点的记录，仅请求从未检测的节点；4 个节点并发，连接异常最多重试1次');
  await Promise.all(Array.from({ length: Math.min(4, proxies.length) }, worker));
  const output = proxies.filter((_, i) => passed[i]).map(p => ({
    ...p, name: '[实测] ' + (p._subName ? p._subName + '｜' : '') + p.name
  }));
  $.info('[实测解锁] 通过 ' + output.length + '/' + proxies.length);
  $.info('[实测解锁] 汇总=' + JSON.stringify(summary));
  if (scanning) $.info('[实测解锁] 原因统计=' + JSON.stringify(Object.fromEntries(Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 8))));
  if (!output.length) throw new Error(scanning ? '检测完成：长期记录中没有同时通过两项检测的节点，请查看日志；不会自动重测' : '长期记录中没有通过节点；若汇总 missing 大于0，请手动运行一次“立即检测解锁节点”，只检测新增节点');
  return output;
}
