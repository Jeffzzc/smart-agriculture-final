export function createState() {
  return {
    sensors: new Map(),
    valves: new Map(),
    strategy: null,
    devices: null,
    policies: [],
    manualOverride: {
      enabled: false,
      valves: {}
    },
    autoJobs: new Map(),
    pendingCommands: new Map()
  }
}

