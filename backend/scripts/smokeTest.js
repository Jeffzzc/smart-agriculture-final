import mqtt from "mqtt"
import WebSocket from "ws"

const mqttUrl = process.env.MQTT_URL ?? "mqtt://127.0.0.1:1883"
const wsUrl = process.env.WS_URL ?? "ws://127.0.0.1:3000/ws"

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  const mqttClient = mqtt.connect(mqttUrl, { reconnectPeriod: 0 })
  await new Promise((resolve, reject) => {
    mqttClient.once("connect", resolve)
    mqttClient.once("error", reject)
  })

  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    ws.once("open", resolve)
    ws.once("error", reject)
  })

  let sensorCount = 0
  let valveCount = 0
  ws.on("message", (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString("utf8"))
    } catch {
      return
    }
    if (msg.kind === "sensor") sensorCount += 1
    if (msg.kind === "valve") valveCount += 1
  })

  console.log("connected")
  console.log("waiting 5s for realtime messages...")
  await wait(5000)
  console.log(JSON.stringify({ sensorCount, valveCount }))

  console.log("sending a manual OPEN to V001 for 5s")
  mqttClient.publish(
    "farm/valves/V001/downlink",
    JSON.stringify({
      commandId: `smoke-${Date.now()}`,
      valveId: "V001",
      action: "OPEN",
      durationSec: 5,
      requestedAt: Date.now()
    }),
    { qos: 1 }
  )
  await wait(2000)
  console.log(JSON.stringify({ sensorCount, valveCount }))

  ws.close()
  mqttClient.end(true)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

