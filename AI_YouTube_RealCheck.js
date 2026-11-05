/* Sub-Store「脚本操作 → 内容」；仅支持 Loon 内运行的后端。
 * 参考可莉 NodeUnlockDetection.js 的逐节点检测思路。
 * 参考作者：XIAO_KOP、keywos、dcpengx。
 * 修正：地区判断、验证页面、非目标 HTML 均不能作为支持结果。
 * 后台检测版：不下载远程 JS，不依据节点名称判断。
 * Loon 脚本标签“实测解锁后台检测”负责扫描；预览/导出仅读取 1 小时内的检测结果。
 */
async function operator(proxies = []) {
  const $ = $substore;
  if (!$.env || !$.env.isLoon) throw new Error('请使用 Loon 内运行的 Sub-Store 后端');
  const cache = scriptResourceCache;
  const entry = typeof $script !== 'undefined' ? $script.name : '未取得Loon脚本标签';
  const scanning = ['实测解锁后台检测', '立即检测解锁节点'].includes(entry);
  const started = Date.now();
  const browserUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Mobile/15E148 Safari/604.1';
  $.info('[实测解锁] 版本=v5，入口=' + entry + '，模式=' + (scanning ? '后台检测' : '读取缓存'));
  const passed = new Array(proxies.length).fill(false);
  const summary = { passed: 0, unsupported: 0, error: 0, missing: 0, expired: 0 };
  const reasons = {};
  let cursor = 0, completed = 0;
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
    const key = 'yc-unlock:result:v5:' + ProxyUtils.hex_md5(node);
    const saved = cache.get(key);
    if (!scanning) {
      const fresh = !!saved && Number.isFinite(saved.time) && Date.now() >= saved.time && Date.now() - saved.time < 3600000;
      passed[index] = fresh && saved.ok === true;
      if (passed[index]) summary.passed++;
      else if (!saved) summary.missing++;
      else if (!fresh) summary.expired++;
      else summary[saved.state === 'unsupported' ? 'unsupported' : 'error']++;
      return;
    }
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
    cache.set(key, { ok, state: kind, time: Date.now(), chatgpt: results[0], youtube: results[1] }, 3600000);
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
  if (scanning) $.info('[实测解锁] 开始检测 ' + proxies.length + ' 个节点；4 个节点并发，每项请求10秒，连接异常最多重试1次');
  await Promise.all(Array.from({ length: Math.min(4, proxies.length) }, worker));
  const output = proxies.filter((_, i) => passed[i]).map(p => ({
    ...p, name: '[实测] ' + (p._subName ? p._subName + '｜' : '') + p.name
  }));
  $.info('[实测解锁] 通过 ' + output.length + '/' + proxies.length);
  $.info('[实测解锁] 汇总=' + JSON.stringify(summary));
  if (scanning) $.info('[实测解锁] 原因统计=' + JSON.stringify(Object.fromEntries(Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 8))));
  if (!output.length) throw new Error(scanning ? '检测完成：没有节点同时通过两项检测，请查看日志' : '没有有效检测结果：请先在 Loon 运行“实测解锁后台检测”，完成后再预览');
  return output;
}
