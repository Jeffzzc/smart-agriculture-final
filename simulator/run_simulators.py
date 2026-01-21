import argparse
import json
import math
import random
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone

import paho.mqtt.client as mqtt


def utc_ms():
    return int(time.time() * 1000)


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def is_daytime(ts_ms):
    dt = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).astimezone()
    return 6 <= dt.hour < 18


def align_next_tick(now_s, period_s):
    return math.ceil(now_s / period_s) * period_s


@dataclass
class SensorMeta:
    device_id: str
    zone: str
    lat: float
    lon: float


@dataclass
class ValveMeta:
    valve_id: str
    zone: str
    lat: float
    lon: float


class BatteryModel:
    def __init__(self, v_init=4.15):
        self.v = float(v_init)

    def drain(self, dv):
        self.v = clamp(self.v - dv, 3.2, 4.2)

    def solar_charge(self, dv):
        self.v = clamp(self.v + dv, 3.2, 4.2)

    def read(self):
        return round(self.v, 3)


class SensorFleetSimulator:
    def __init__(self, client: mqtt.Client, metas: list[SensorMeta], acreage=500):
        self.client = client
        self.metas = metas
        self.acreage = acreage
        self.batteries = {m.device_id: BatteryModel(4.1 - random.random() * 0.3) for m in metas}
        self.last_humidity = {m.device_id: 40.0 + random.uniform(-3, 3) for m in metas}
        self.last_temp = {m.device_id: 22.0 + random.uniform(-2, 2) for m in metas}

    def make_payload(self, meta: SensorMeta, ts_ms: int):
        b = self.batteries[meta.device_id]
        hum = self.last_humidity[meta.device_id]
        temp = self.last_temp[meta.device_id]

        temp = clamp(temp + random.uniform(-0.4, 0.4), 10, 40)
        hum = clamp(hum + random.uniform(-1.0, 1.0), 10, 90)

        if is_daytime(ts_ms):
            b.solar_charge(0.0008)
        b.drain(0.0018)

        self.last_humidity[meta.device_id] = hum
        self.last_temp[meta.device_id] = temp

        rssi = int(random.uniform(-120, -70))
        snr = round(random.uniform(-10, 10), 1)

        return {
            "deviceId": meta.device_id,
            "type": "soil",
            "zone": meta.zone,
            "ts": ts_ms,
            "lat": meta.lat,
            "lon": meta.lon,
            "tempC": round(temp, 2),
            "humidityPct": round(hum, 2),
            "batteryV": b.read(),
            "rssi": rssi,
            "snr": snr,
            "acreageCoverage": round(self.acreage / max(1, len(self.metas)), 2),
        }

    def publish_tick(self, ts_ms: int):
        for meta in self.metas:
            payload = self.make_payload(meta, ts_ms)
            topic = f"farm/sensors/{meta.device_id}/uplink"
            self.client.publish(topic, json.dumps(payload), qos=1)


class ValveSimulator:
    def __init__(self, client: mqtt.Client, metas: list[ValveMeta]):
        self.client = client
        self.metas = metas
        self.batteries = {m.valve_id: BatteryModel(4.05 - random.random() * 0.35) for m in metas}
        self.state = {m.valve_id: "CLOSE" for m in metas}
        self.open_jobs: dict[str, threading.Timer] = {}
        for m in metas:
            client.message_callback_add(f"farm/valves/{m.valve_id}/downlink", self._on_command)
            client.subscribe(f"farm/valves/{m.valve_id}/downlink", qos=1)
        for m in metas:
            t = threading.Timer(random.uniform(0.1, 0.8), lambda vid=m.valve_id: self._emit_status(vid, None, "BOOT"))
            t.daemon = True
            t.start()

    def publish_heartbeat(self):
        for m in self.metas:
            self._emit_status(m.valve_id, None, "HEARTBEAT")

    def _emit_status(self, valve_id: str, command_id: str | None, action: str):
        b = self.batteries[valve_id]
        if action == "OPEN":
            b.drain(0.010)
        else:
            b.drain(0.004)
        if is_daytime(utc_ms()):
            b.solar_charge(0.0012)

        rssi = int(random.uniform(-115, -65))
        snr = round(random.uniform(-12, 12), 1)
        payload = {
            "valveId": valve_id,
            "commandId": command_id,
            "state": self.state[valve_id],
            "batteryV": b.read(),
            "rssi": rssi,
            "snr": snr,
            "ts": utc_ms(),
            "respondedAt": utc_ms(),
        }
        self.client.publish(f"farm/valves/{valve_id}/status", json.dumps(payload), qos=1)

    def _schedule_close(self, valve_id: str, duration_sec: int):
        if valve_id in self.open_jobs:
            self.open_jobs[valve_id].cancel()
        t = threading.Timer(duration_sec, lambda: self._apply(valve_id, None, "CLOSE", 0))
        self.open_jobs[valve_id] = t
        t.daemon = True
        t.start()

    def _apply(self, valve_id: str, command_id: str | None, action: str, duration_sec: int):
        if action == "OPEN":
            self.state[valve_id] = "OPEN"
            if duration_sec and duration_sec > 0:
                self._schedule_close(valve_id, duration_sec)
        elif action == "CLOSE":
            self.state[valve_id] = "CLOSE"
            if valve_id in self.open_jobs:
                self.open_jobs[valve_id].cancel()
                del self.open_jobs[valve_id]
        self._emit_status(valve_id, command_id, action)

    def _on_command(self, client, userdata, msg):
        try:
            payload = json.loads(msg.payload.decode("utf-8"))
        except Exception:
            return
        valve_id = str(payload.get("valveId") or "")
        if not valve_id or valve_id not in self.state:
            return
        action = str(payload.get("action") or "").upper()
        command_id = payload.get("commandId")
        duration_sec = payload.get("durationSec")
        if duration_sec is None:
            duration_sec = 0
        try:
            duration_sec = int(duration_sec)
        except Exception:
            duration_sec = 0
        if action not in ("OPEN", "CLOSE"):
            return
        time.sleep(random.uniform(0.05, 0.25))
        self._apply(valve_id, command_id, action, duration_sec)


def load_default_metas():
    sensors = []
    valves = []
    base_lat = 30.0
    base_lon = 120.0
    for i in range(50):
        zone = f"Z{(i // 5) + 1}"
        sensors.append(
            SensorMeta(
                device_id=f"S{i+1:03d}",
                zone=zone,
                lat=base_lat + 0.0002 * (i + 1),
                lon=base_lon + 0.0002 * (i + 1),
            )
        )
    for i in range(10):
        zone = f"Z{i+1}"
        valves.append(
            ValveMeta(
                valve_id=f"V{i+1:03d}",
                zone=zone,
                lat=base_lat + 0.00025 * (i + 1),
                lon=base_lon + 0.00025 * (i + 1),
            )
        )
    return sensors, valves


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mqtt-host", default="127.0.0.1")
    parser.add_argument("--mqtt-port", type=int, default=1883)
    parser.add_argument("--time-scale", type=float, default=1.0)
    parser.add_argument("--client-prefix", default="sim")
    args = parser.parse_args()

    sensors, valves = load_default_metas()

    client = mqtt.Client(
        client_id=f"{args.client_prefix}-{random.randint(1000,9999)}",
        protocol=mqtt.MQTTv311,
        callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
    )
    client.reconnect_delay_set(min_delay=1, max_delay=30)

    def _reconnect_forever(c):
        while True:
            try:
                c.reconnect()
                return
            except Exception:
                time.sleep(2)

    def _on_disconnect(c, u, disconnect_flags, reason_code, properties):
        t = threading.Thread(target=_reconnect_forever, args=(c,), daemon=True)
        t.start()

    client.on_disconnect = _on_disconnect

    def _connect_with_retry():
        while True:
            try:
                client.connect(args.mqtt_host, args.mqtt_port, keepalive=60)
                return
            except Exception:
                time.sleep(1)

    _connect_with_retry()
    client.loop_start()

    sensor_sim = SensorFleetSimulator(client, sensors, acreage=500)
    valve_sim = ValveSimulator(client, valves)

    period_s = 1800
    now_s = time.time()
    next_tick = align_next_tick(now_s, period_s)

    while True:
        now = time.time()
        sleep_s = max(0.0, next_tick - now)
        scaled_sleep = sleep_s / max(0.0001, args.time_scale)
        time.sleep(scaled_sleep)
        ts_ms = int(next_tick * 1000)
        sensor_sim.publish_tick(ts_ms)
        valve_sim.publish_heartbeat()
        next_tick += period_s


if __name__ == "__main__":
    main()

