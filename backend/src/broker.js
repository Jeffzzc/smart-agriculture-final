import net from "node:net"
import Aedes from "aedes"

export function startMqttBroker({ host, port }) {
  const aedes = new Aedes()
  const server = net.createServer(aedes.handle)
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, host, () => {
      resolve({ aedes, server })
    })
  })
}

