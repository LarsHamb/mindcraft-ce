// Turm-Test: Bot baut sich mit dem Pathfinder 6 Bloecke hoch. Zaehlt Spruenge, Platzierungen, Fehler.
const m = require("mineflayer"); const {pathfinder, Movements, goals} = require("mineflayer-pathfinder"); const Vec3 = require("vec3");
const MARGIN = process.env.MARGIN; // optional: Patch-Simulation
const b = m.createBot({host: "mc-echt26", port: 25565, username: "Turmbau", version: "26.3", auth: "offline"});
b.loadPlugin(pathfinder);
let jumps = 0, wasJump = false, placed = 0, errors = 0;
b.on("physicsTick", () => { const j = b.controlState.jump; if (j && !wasJump) jumps++; wasJump = j; });
b.once("spawn", async () => {
  await new Promise(r => setTimeout(r, 12000)); // rcon teleport + give
  const start = b.entity.position.floored();
  const mv = new Movements(b); mv.allow1by1towers = true; mv.canDig = false;
  mv.scaffoldingBlocks = [b.registry.itemsByName.cobblestone.id];
  b.pathfinder.setMovements(mv);
  const place = b.placeBlock.bind(b);
  b.placeBlock = async (...a) => { try { const r = await place(...a); placed++; return r; } catch (e) { errors++; console.log("place error:", e.message.slice(0, 120)); throw e; } };
  const t0 = Date.now();
  const target = start.offset(0, 6, 0);
  const timer = setTimeout(() => { b.pathfinder.stop(); }, 60000);
  try { await b.pathfinder.goto(new goals.GoalBlock(target.x, target.y, target.z)); } catch (e) { console.log("goto:", e.message); }
  clearTimeout(timer);
  console.log(JSON.stringify({result: b.entity.position.floored().y - start.y, wanted: 6, jumps, placed, errors, seconds: Math.round((Date.now() - t0) / 1000), cobble: b.inventory.items().filter(i => i.name === "cobblestone").reduce((n, i) => n + i.count, 0)}));
  process.exit(0);
});
b.on("kicked", r => { console.log("KICK", JSON.stringify(r)); process.exit(1); });
