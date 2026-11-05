/* Loon Generic 专用入口；只负责调用官方 Sub-Store 任务及显示结束结果。 */
(function () {
  let ended = false, loaded = false, summary = null, lastError = "";
  const nativeConsole = console;
  const originalDone = $done;
  const officialURL = "https://github.com/sub-store-org/Sub-Store/releases/latest/download/cron-sync-artifacts.min.js";
  const sourceKey = "yc-unlock:launcher:official:v1";
  function clean(value) {
    return String(value || "").replace(/https?:\/\/[^\s<>"']+/gi, "[URL]")
      .replace(/((?:token|password|authorization|secret|cookie)\s*[=:]\s*)[^\s,;]+/gi, "$1[已隐藏]").slice(0, 240);
  }
  function finish(value) {
    if (ended) return;
    ended = true;
    let title = "节点检测入口已结束";
    let content;
    if (lastError) title = "节点检测存在错误";
    if (summary) {
      title = summary.passed > 0 ? "节点筛选结果" : "本次没有可输出节点";
      content = "通过：" + (summary.passed || 0) +
        "\n明确受限：" + (summary.unsupported || 0) +
        "\n检测异常：" + (summary.error || 0) +
        "\n尚无记录：" + (summary.missing || 0) +
        "\n本次新检测：" + (summary.tested == null ? "旧版未提供" : summary.tested) +
        "\n复用记录：" + (summary.reused == null ? "旧版未提供" : summary.reused);
      if (lastError) content += "\n提示：" + lastError;
    } else if (value && typeof value.content === "string" && value.content.trim()) {
      title = value.title || title;
      content = value.content;
    } else {
      content = lastError || "入口已结束，但没有收到检测摘要。不能据此认定检测成功，请检查 Sub-Store 后端日志及组合订阅名称。";
    }
    originalDone({ title: title, content: content });
  }
  const capture = {
    log: function () {
      const line = Array.from(arguments).map(String).join(" ");
      nativeConsole.log(line);
      const marker = "[实测解锁] 汇总=";
      const pos = line.indexOf(marker);
      if (pos >= 0) {
        try { summary = JSON.parse(line.slice(pos + marker.length)); } catch (_) {}
      }
      if (/\bERROR:/.test(line)) lastError = clean(line);
    },
    info: function () { capture.log.apply(null, arguments); },
    warn: function () { capture.log.apply(null, arguments); },
    error: function () { capture.log.apply(null, arguments); }
  };
  function run(code, save) {
    try {
      const execute = new Function("$done", "$argument", "$script", "$persistentStore", "console", code);
      if (save) $persistentStore.write(code, sourceKey);
      loaded = true;
      const result = execute(finish,
        "col=%E8%8A%82%E7%82%B9%E7%AD%9B%E9%80%89",
        $script, $persistentStore, capture);
      if (result && typeof result.catch === "function") {
        result.catch(function (error) { lastError = clean(error && error.message || error); finish(); });
      }
    } catch (error) {
      lastError = "入口执行失败：" + clean(error && error.message || error);
      finish();
    }
  }
  try {
    const cached = $persistentStore.read(sourceKey);
    if (typeof cached === "string" && cached.trim()) { run(cached, false); return; }
    setTimeout(function () {
      if (!loaded && !ended) { lastError = "下载官方任务脚本超过16秒，尚未开始检测。"; finish(); }
    }, 16000);
    $httpClient.get({url: officialURL, timeout: 15000}, function (error, response, body) {
      if (ended) return;
      if (error) { lastError = "下载官方任务脚本失败：" + clean(error); finish(); return; }
      const status = Number(response && (response.status || response.statusCode));
      if (status !== 200 || typeof body !== "string" || !body.trim() || /^\s*</.test(body)) {
        lastError = "官方任务脚本响应无效，HTTP " + status + "，尚未开始检测。"; finish(); return;
      }
      run(body, true);
    });
  } catch (error) { lastError = clean(error && error.message || error); finish(); }
})();