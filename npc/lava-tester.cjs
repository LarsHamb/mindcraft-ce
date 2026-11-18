// Kurztest fuer ruf-test.sh: nur Lava neben den Bot kippen, mit Positionen im Log.
const m=require("mineflayer");const {Vec3}=require("vec3");const b=m.createBot({host:"mc-echt26",port:25565,username:"Tester",version:"26.3",auth:"offline"});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
b.on("chat",(u,t)=>{if(u!=="Tester")console.log("CHAT",u+":",t)});
b.once("spawn",async()=>{
  await wait(12000);
  const t=b.players.MindCE?.entity; const lava=b.inventory.items().find(i=>i.name==="lava_bucket");
  console.log("ich",b.entity.position.floored(),"bot",t&&t.position.floored(),"lava",!!lava);
  if(t&&lava){
    // Boden zwischen uns, 1 Block vom Bot weg
    const dir=b.entity.position.minus(t.position); const step=new Vec3(Math.sign(Math.round(dir.x)),0,Math.sign(Math.round(dir.z)));
    const floor=b.blockAt(t.position.floored().plus(step).offset(0,-1,0));
    await b.equip(lava,"hand"); await b.lookAt(floor.position.offset(0.5,1,0.5),true);
    b.activateItem(); await wait(400); b.deactivateItem(); await wait(800);
    console.log("ziel",floor.position.offset(0,1,0),"jetzt",b.blockAt(floor.position.offset(0,1,0))?.name,"hand",b.heldItem?.name);
  }
  await wait(15000); process.exit(0);
});
