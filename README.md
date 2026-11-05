# Loon 实测节点筛选

用于 Loon 内运行的 Sub-Store。逐个指定节点出口检测 ChatGPT 和 YouTube Premium，同时通过才进入输出。逐节点请求的思路参考可莉 NodeUnlockDetection.js（XIAO_KOP、keywos、dcpengx），判定逻辑已增加严格响应检查。不根据节点名称判断支持情况，也不依赖运行时下载检测 JS。

## 远程地址

- Sub-Store 脚本：https://raw.githubusercontent.com/yinanan77/loon-unlock-tools/main/AI_YouTube_RealCheck.js
- Loon 后台插件：https://raw.githubusercontent.com/yinanan77/loon-unlock-tools/main/UnlockBackground.lpx

## 使用

1. 在 Sub-Store 将所需订阅组成一个组合订阅，其内部「名称」设为 `节点筛选`。显示名称可以自行修改。
2. 为该组合订阅添加「脚本操作」，类型选「链接」，填入本仓库 `AI_YouTube_RealCheck.js` 的 GitHub Raw 地址。
3. 在 Loon 安装本仓库 `UnlockBackground.lpx` 的 Raw 地址。若主配置已有同名后台脚本，先移除重复项。
4. 在 Loon 手动执行「立即检测解锁节点」。保持 Loon 运行，在日志看到检测完成后，再打开组合订阅预览。
5. 从 Sub-Store 复制此组合订阅的 Loon 格式输出地址，用于实际的策略组接入。

GitHub 仓库地址不等于 Sub-Store 的节点输出地址。脚本托管在 GitHub，检测和节点输出仍在手机本地完成。本仓库不需要私人订阅 URL、token 或证书。

## 耗时与缓存

- 后台脚本使用 Sub-Store 官方 `cron-sync-artifacts.min.js`，指定组合订阅运行，Loon 执行时限 900 秒。
- 手动脚本标签为「立即检测解锁节点」，定时脚本标签为「实测解锁后台检测」。检测 JS 根据 Loon `$script.name` 识别后台入口；更改这两个标签时必须同步修改 JS。
- 后台每半小时重测并保存每个节点的通过/未通过结果。预览和导出仅读取一小时内有效的成功结果，不发起逐节点检测。
- 无有效结果时明确报错，不混入未经检测的节点。订阅源自身的下载仍需要网络访问。
- iOS 后台调度、节点数量、请求排队和网络状态可能影响完成时间。查看 Loon/Sub-Store 日志确认实际运行情况。

## 检测边界与验证

ChatGPT 检测必须取得并识别 ChatGPT 主站网页，地区代码不再作为成功依据。YouTube 检测必须取得并识别英文 Premium 页面。验证页、403、异常HTML和连接错误均不会入选。日志区分明确受限和检测异常；受浏览器验证影响，检测异常不等于该节点永久不支持。两项网页检查也不等于登录账号后全部功能可用。旧版v3缓存已隔离，更新后必须先执行一次后台检测。

已完成本地回归测试（包括错误页200、验证页200、403、地区信息假阳性、旧缓存污染和出口绑定）；尚未在用户的 Loon/Sub-Store 中端到端验证。尤其需要实机确认后台标签传入脚本，以及首次检测成功后预览只读取缓存。

运行 `node test.cjs` 进行模拟检查。

参考：

- https://kelee.one/Resource/JavaScript/Node_detection_tool/NodeUnlockDetection.js
- https://sub-store-org.github.io/doc/subscription/overview
- https://nsloon.app/docs/Script/script_api/
