const m=require("mineflayer");const b=m.createBot({host:"mc-echt26",port:25565,username:"Tester",version:"26.3",auth:"offline"});
const msgs=(process.env.MSGS||"").split("|");
b.once("spawn",async()=>{await new Promise(r=>setTimeout(r,4000));for(const t of msgs){b.chat(t);await new Promise(r=>setTimeout(r,5000));}setTimeout(()=>process.exit(0),3000);});
b.on("chat",(u,t)=>{if(u!=="Tester")console.log("CHAT",u+":",t)});
