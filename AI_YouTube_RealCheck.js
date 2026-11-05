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
  $.info('[实测解锁] 入口=' + entry + '，模式=' + (scanning ? '后台检测' : '读取缓存'));
  const passed = new Array(proxies.length).fill(false);
  const summary = { passed: 0, unsupported: 0, error: 0, missing: 0 };
  let cursor = 0;
  async function get(node, url, extra = {}) {
    return $.http.get({ url, timeout: 10000, ...extra, node, 'policy-descriptor': node });
  }
  function status(response) {
    return Number(response.statusCode || response.status);
  }
  function state(kind, reason) { return { state: kind, reason }; }
  function challenged(body) {
    return /<title[^>]*>\s*(just a moment|attention required)|cf-chl-|challenge-platform|verify (that )?you are human|unusual traffic|consent\.youtube\.com/i.test(body);
  }
  async function chatgpt(node) {
    try {
      const response = await get(node, 'https://chatgpt.com/', {
        headers: { 'Accept-Language': 'en-US,en;q=0.9' }
      });
      const body = typeof response.body === 'string' ? response.body : '';
      if (challenged(body)) return state('error', '网站验证拦截');
      if (/unsupported_country|country.{0,30}not supported|region.{0,30}not supported/i.test(body)) return state('unsupported', '地区限制');
      if (status(response) !== 200) return state('error', 'HTTP ' + status(response));
      if (/ChatGPT/i.test(body) && /__NEXT_DATA__|__next|__reactRouterContext|__reactRouterManifest|oaistatic\.com|chatgpt\.com\/cdn\/assets/i.test(body)) return state('passed', '识别到ChatGPT网页');
      return state('error', '未识别到ChatGPT网页');
    } catch (_) { return state('error', '连接失败或超时'); }
  }
  async function youtube(node) {
    try {
      const response = await get(node, 'https://www.youtube.com/premium?hl=en', {
        headers: {
          'Accept-Language': 'en-US,en;q=0.9',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.61 Safari/537.36'
        }
      });
      const body = typeof response.body === 'string' ? response.body : '';
      if (challenged(body)) return state('error', '网站验证或同意页面');
      if (status(response) !== 200) return state('error', 'HTTP ' + status(response));
      if (/Premium is not available in your country|Premium is not available in your region|Premium is unavailable in your country/i.test(body)) return state('unsupported', 'Premium地区限制');
      if (/ytInitialData/.test(body) && /YouTube Premium/.test(body)) return state('passed', '识别到Premium网页');
      return state('error', '未识别到Premium网页');
    } catch (_) { return state('error', '连接失败或超时'); }
  }
  async function check(proxy, index) {
    let node;
    try { node = ProxyUtils.produce([proxy], 'Loon'); }
    catch (_) { summary.error++; return; }
    if (typeof node !== 'string' || !node.trim()) { summary.error++; return; }
    const key = 'yc-unlock:result:v4:' + ProxyUtils.hex_md5(node);
    const saved = cache.get(key);
    if (!scanning) {
      passed[index] = !!saved && saved.ok === true && Date.now() - saved.time < 3600000;
      if (passed[index]) summary.passed++;
      else if (!saved) summary.missing++;
      else summary[saved.state === 'unsupported' ? 'unsupported' : 'error']++;
      return;
    }
    const results = await Promise.all([chatgpt(node), youtube(node)]);
    const ok = results.every(item => item.state === 'passed');
    const kind = ok ? 'passed' : results.some(item => item.state === 'error') ? 'error' : 'unsupported';
    passed[index] = ok;
    summary[kind]++;
    cache.set(key, { ok, state: kind, time: Date.now(), chatgpt: results[0], youtube: results[1] }, 3600000);
    $.info('[实测解锁] ' + proxy.name + '：ChatGPT=' + results[0].state + '(' + results[0].reason + ')；YouTube=' + results[1].state + '(' + results[1].reason + ')');
  }
  async function worker() {
    while (cursor < proxies.length) {
      const index = cursor++;
      await check(proxies[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, proxies.length) }, worker));
  const output = proxies.filter((_, i) => passed[i]).map(p => ({
    ...p, name: '[实测] ' + (p._subName ? p._subName + '｜' : '') + p.name
  }));
  $.info('[实测解锁] 通过 ' + output.length + '/' + proxies.length);
  $.info('[实测解锁] 汇总=' + JSON.stringify(summary));
  if (!output.length) throw new Error(scanning ? '检测完成：没有节点同时通过两项检测，请查看日志' : '没有有效检测结果：请先在 Loon 运行“实测解锁后台检测”，完成后再预览');
  return output;
}
