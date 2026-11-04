/* Sub-Store「脚本操作 → 内容」；仅支持 Loon 内运行的后端。
 * 检测入口和判定依据来自可莉 NodeUnlockDetection.js。
 * 检测原作者：XIAO_KOP、keywos、dcpengx。
 * 后台检测版：不下载远程 JS，不依据节点名称判断。
 * Loon 脚本标签“实测解锁后台检测”负责扫描；预览/导出仅读取 1 小时内的检测结果。
 */
async function operator(proxies = []) {
  const $ = $substore;
  if (!$.env || !$.env.isLoon) throw new Error('请使用 Loon 内运行的 Sub-Store 后端');
  const regions = new Set('T1 XX AL DZ AD AO AG AR AM AU AT AZ BS BD BB BE BZ BJ BT BA BW BR BG BF CV CA CL CO KM CR HR CY DK DJ DM DO EC SV EE FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HU IS IN ID IQ IE IL IT JM JP JO KZ KE KI KW KG LV LB LS LR LI LT LU MG MW MY MV ML MT MH MR MU MX MC MN ME MA MZ MM NA NR NP NL NZ NI NE NG MK NO OM PK PW PA PG PE PH PL PT QA RO RW KN LC VC WS SM ST SN RS SC SL SG SK SI SB ZA ES LK SR SE CH TH TG TO TT TN TR TV UG AE US UY VU ZM BO BN CG CZ VA FM MD PS KR TW TZ TL GB'.split(' '));
  const cache = scriptResourceCache;
  const scanning = typeof $script !== 'undefined' && ['实测解锁后台检测', '立即检测解锁节点'].includes($script.name);
  $.info('[实测解锁] ' + (scanning ? '后台检测开始' : '读取检测缓存')); 
  const passed = new Array(proxies.length).fill(false);
  let cursor = 0;
  async function get(node, url, extra = {}) {
    return $.http.get({ url, timeout: 10000, ...extra, node, 'policy-descriptor': node });
  }
  function status(response) {
    return Number(response.statusCode || response.status);
  }
  async function chatgpt(node) {
    try {
      const main = await get(node, 'https://chat.openai.com/', { 'auto-redirect': false });
      if (JSON.stringify(main.headers || {}).toLowerCase().includes('text/plain')) return false;
      const trace = await get(node, 'https://chat.openai.com/cdn-cgi/trace');
      if (status(trace) !== 200 || typeof trace.body !== 'string') return false;
      const match = trace.body.match(/^loc=([A-Z0-9]{2})\s*$/m);
      return !!match && regions.has(match[1]);
    } catch (_) { return false; }
  }
  async function youtube(node) {
    try {
      const response = await get(node, 'https://www.youtube.com/premium', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.61 Safari/537.36' }
      });
      return status(response) === 200 && typeof response.body === 'string' &&
        response.body.length > 0 && !response.body.includes('Premium is not available in your country');
    } catch (_) { return false; }
  }
  async function check(proxy, index) {
    let node;
    try { node = ProxyUtils.produce([proxy], 'Loon'); }
    catch (_) { return; }
    if (typeof node !== 'string' || !node.trim()) return;
    const key = 'yc-unlock:result:v3:' + ProxyUtils.hex_md5(node);
    const saved = cache.get(key);
    if (!scanning) {
      passed[index] = !!saved && saved.ok === true && Date.now() - saved.time < 3600000;
      return;
    }
    const results = await Promise.all([chatgpt(node), youtube(node)]);
    const ok = results.every(Boolean);
    passed[index] = ok;
    cache.set(key, { ok, time: Date.now() }, 3600000);
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
  if (!output.length) throw new Error(scanning ? '检测完成：没有节点同时通过两项检测，请查看日志' : '没有有效检测结果：请先在 Loon 运行“实测解锁后台检测”，完成后再预览');
  return output;
}
