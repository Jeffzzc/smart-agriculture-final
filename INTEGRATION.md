# final_convert 集成说明（smart-agriculture + code 灌溉功能）

## 基座选择
- 以 `smart-agriculture` 的目录结构与运行方式为基座：Node.js 后端（MQTT Broker + HTTP API + WebSocket）+ Vue3 前端。
- 保留原有数据链路：MQTT uplink → 后端 state → WS 推送 → 前端展示；以及前端 API → 后端 → MQTT downlink 控制阀门。

## 从 code 提取并合并的灌溉能力
`code` 后端的核心灌溉逻辑为 IrrigationPolicy：当某个传感器上报湿度低于阈值时，对指定阀门发送 OPEN(duration) 控制。

在本实现中：
- 将 IrrigationPolicy 的“按传感器/阀门绑定、按湿度阈值触发、带时长”能力迁移到 Node 后端，形成 policies 机制。
- 在保留 smart-agriculture 原有“按分区阈值触发（threshold）”的同时，新增 `autoMethod` 选择：
  - `threshold`：原有逻辑（按传感器所属分区 → 找分区阀门）。
  - `policy`：新增逻辑（按 policies 中的 sensorId/valveId 精确控制）。

## 手动覆盖（Manual Override）
为满足“手动一键开关（ON/OFF）+ 状态可见 + 不影响原有自动能力”：
- 新增手动覆盖状态 `manualOverride`：
  - 全局开关 `enabled`
  - 按阀门维度的覆盖项 `valves[valveId]`（enabled/desiredState/updatedAt）
- 自动灌溉在执行前会检查：若该阀门处于“手动覆盖启用”，则自动逻辑不会改变该阀门状态。
- 前端控制面板提供每个阀门的“开启/关闭”切换按钮，会自动进入手动覆盖；提供“释放手动”恢复该阀门可被自动控制。

## 后端改动点（final_convert/backend）
- 状态扩展：`src/state.js` 新增 `policies` 与 `manualOverride`。
- 灌溉控制器：`src/irrigation.js`
  - 兼容原阈值控制，并新增 policy 控制分支（`strategy.autoMethod === "policy"`）。
  - 新增手动覆盖阻断逻辑与 toggle 操作。
  - 阀门控制增加 MQTT 连接检查与错误抛出，API 层返回可读错误。
- WS hello 消息扩展：`src/ws.js` 在 hello 中额外携带 `policies` 与 `manualOverride`。
- API 扩展：`src/routes.js`
  - `GET/PUT /api/policies`
  - `GET/POST /api/override`
  - `POST /api/valves/:valveId/toggle`
- 数据文件：
  - `backend/data/strategy/policies.json`
  - `backend/data/strategy/override.json`
  - `backend/data/strategy/strategy.json` 新增 `autoMethod` 与 `manualOpenDurationSec`
- 端口兼容：
  - 若 1883 端口已被外部 MQTT Broker（如 Mosquitto）占用，后端会自动跳过内置 Broker 启动并直接使用外部 Broker。
  - HTTP/WS 端口仍建议通过环境变量覆盖：`HTTP_PORT`（默认 3000）。

## 前端改动点（final_convert/frontend）
- 新增灌溉控制组件：`src/components/IrrigationControl.vue`
  - 自动方式选择（threshold / policy）
  - policy 编辑与保存
  - 阀门“手动覆盖一键开关”与“释放手动”
- 控制页改造：`src/pages/ControlPage.vue` 使用新组件。
- App 状态管理：`src/App.vue`
  - 增加 `policies`、`manualOverride` 的加载、WS 同步与错误提示。
- 地图页状态可见：`src/pages/MapPage.vue`
  - 右上角汇总显示“灌溉中 / 手动覆盖”
  - 手动覆盖阀门以橙色菱形标识

## API 一览（新增/扩展）
- `GET /api/policies` → `{ policies: [...] }`
- `PUT /api/policies` → body: `policies[]`（会做基础归一化与过滤）
- `GET /api/override` → `{ enabled, valves }`
- `POST /api/override`
  - 全局：`{ globalEnabled: true|false }`
  - 单阀门：`{ valveId, enabled: true|false, desiredState: "OPEN"|"CLOSE"|null, durationSec? }`
- `POST /api/valves/:valveId/toggle` → 自动进入手动覆盖并切换开/关

## 验证与测试建议
- 后端：
  - `npm run validate`：统计当天 history 的传感器 tick、阀门延迟等信息。
  - `npm run smoke`：需先启动后端，再执行 smoke 连接 MQTT/WS 并发送 OPEN 示例。
- 前端：
  - `npm run build`：构建通过即可确认基础编译与依赖正确。
