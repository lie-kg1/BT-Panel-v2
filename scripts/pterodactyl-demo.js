// Local development helper: fake Pterodactyl API + Wings websocket.
// Started automatically when PTERODACTYL_DEMO=1. Not for production.
const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");

const DEMO_SERVERS = [
  {
    object: "server",
    attributes: {
      identifier: "a1b2c3d4",
      uuid: "d3f5d2a0-1111-4a22-9c33-demo00000001",
      name: "Survival SMP",
      node: "node-1",
      description: "Main survival world",
      status: null,
      suspended: false,
      limits: { memory: 4096, swap: 0, disk: 10240, io: 500, cpu: 200 },
      feature_limits: { databases: 2, allocations: 2, backups: 5 },
    },
  },
  {
    object: "server",
    attributes: {
      identifier: "e5f6a7b8",
      uuid: "d3f5d2a0-2222-4a22-9c33-demo00000002",
      name: "Creative Plots",
      node: "node-1",
      description: "",
      status: null,
      suspended: false,
      limits: { memory: 2048, swap: 0, disk: 5120, io: 500, cpu: 100 },
      feature_limits: { databases: 1, allocations: 1, backups: 2 },
    },
  },
  {
    object: "server",
    attributes: {
      identifier: "c9d0e1f2",
      uuid: "d3f5d2a0-3333-4a22-9c33-demo00000003",
      name: "Modded SkyFactory",
      node: "node-2",
      description: "SF4 test instance",
      status: null,
      suspended: false,
      limits: { memory: 8192, swap: 0, disk: 20480, io: 500, cpu: 300 },
      feature_limits: { databases: 4, allocations: 3, backups: 10 },
    },
  },
];

const serverState = new Map(
  DEMO_SERVERS.map((s) => [
    s.attributes.identifier,
    { state: s.attributes.identifier === "e5f6a7b8" ? "offline" : "running", startedAt: Date.now() },
  ])
);

function resourcesFor(id) {
  const s = serverState.get(id);
  const running = s.state === "running" || s.state === "starting";
  const t = Date.now() / 1000;
  return {
    object: "stats",
    attributes: {
      current_state: s.state,
      is_suspended: false,
      resources: {
        memory_bytes: running ? Math.round(1200e6 + 300e6 * Math.sin(t / 20)) : 0,
        memory_limit_bytes: 4294967296,
        cpu_absolute: running ? Math.max(0, 42 + 25 * Math.sin(t / 7)) : 0,
        disk_bytes: 3_200_000_000,
        network_rx_bytes: Math.round(t * 5000),
        network_tx_bytes: Math.round(t * 8000),
        uptime: running ? Date.now() - s.startedAt : 0,
      },
    },
  };
}

function startPterodactylDemo(port = 48080) {
  const app = express();
  app.use(express.json());

  app.get("/api/client", (_req, res) => {
    res.json({
      object: "list",
      data: DEMO_SERVERS,
      meta: { pagination: { total: DEMO_SERVERS.length, count: DEMO_SERVERS.length, per_page: 50, current_page: 1, total_pages: 1 } },
    });
  });

  app.get("/api/client/servers/:id/resources", (req, res) => {
    if (!serverState.has(req.params.id)) return res.status(404).json({ errors: [{ code: "NotFoundHttpException", detail: "Not found." }] });
    res.json(resourcesFor(req.params.id));
  });

  app.post("/api/client/servers/:id/power", (req, res) => {
    const s = serverState.get(req.params.id);
    if (!s) return res.status(404).json({ errors: [{ code: "NotFoundHttpException", detail: "Not found." }] });
    const signal = String((req.body && req.body.signal) || "");
    const map = { start: "starting", stop: "stopping", restart: "starting", kill: "offline" };
    if (!map[signal]) return res.status(422).json({ errors: [{ code: "ValidationException", detail: "Bad signal." }] });
    s.state = map[signal];
    if (signal === "start" || signal === "restart") s.startedAt = Date.now();
    setTimeout(() => {
      if (signal === "start" || signal === "restart") s.state = "running";
      else if (signal === "stop" || signal === "kill") s.state = "offline";
    }, 2500);
    res.status(204).end();
  });

  app.post("/api/client/servers/:id/command", (req, res) => {
    if (!serverState.has(req.params.id)) return res.status(404).json({ errors: [{ code: "NotFoundHttpException", detail: "Not found." }] });
    console.log(`[demo-wings] command on ${req.params.id}: ${(req.body || {}).command}`);
    res.status(204).end();
  });

  app.get("/api/client/servers/:id/websocket", (req, res) => {
    if (!serverState.has(req.params.id)) return res.status(404).json({ errors: [{ code: "NotFoundHttpException", detail: "Not found." }] });
    res.json({ data: { token: `demo-token-${req.params.id}`, socket: `ws://127.0.0.1:${port}/api/servers/${req.params.id}/ws` } });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: undefined });

  wss.on("connection", (ws, req) => {
    const match = /\/api\/servers\/([a-zA-Z0-9-]+)\/ws/.exec(req.url || "");
    const id = match && match[1];
    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
      if (msg.event === "auth") {
        ws.send(JSON.stringify({ event: "auth success" }));
        ws.send(JSON.stringify({ event: "status", args: [(serverState.get(id) || {}).state || "offline"] }));
        ws.send(JSON.stringify({ event: "console output", args: ["[demo-wings] Connected to demo console."] }));
        ws.send(JSON.stringify({ event: "console output", args: [`[demo-wings] Server ${id} — type away, commands are logged server-side.`] }));
      }
      if (msg.event === "send command") {
        ws.send(JSON.stringify({ event: "console output", args: [`> ${(msg.args || []).join(" ")}`] }));
      }
    });
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`[demo] Fake Pterodactyl panel listening on http://127.0.0.1:${port}`);
  });
  return server;
}

module.exports = { startPterodactylDemo };

if (require.main === module) startPterodactylDemo(Number(process.argv[2] || 48080));
