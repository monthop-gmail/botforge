/** หน้าเว็บเล็ก ๆ ไว้ทดสอบ — ไม่มี dependency ไม่มี build step */
export const PAGE = (title: string): string => `<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
:root{color-scheme:light dark}
body{font-family:system-ui,-apple-system,"Noto Sans Thai",sans-serif;max-width:44rem;margin:0 auto;padding:1.5rem;line-height:1.6}
h1{font-size:1.1rem;margin:0 0 .25rem}
.sub{opacity:.6;font-size:.85rem;margin-bottom:1rem}
#log{border:1px solid color-mix(in srgb, currentColor 20%, transparent);border-radius:.5rem;padding:.75rem;height:60vh;overflow:auto}
.m{margin:.4rem 0;padding:.5rem .7rem;border-radius:.5rem;white-space:pre-wrap;word-break:break-word}
.user{background:color-mix(in srgb, currentColor 10%, transparent);margin-left:15%}
.bot{background:color-mix(in srgb, currentColor 5%, transparent);margin-right:15%}
.sys{opacity:.55;font-size:.8rem;text-align:center;background:none}
form{display:flex;gap:.5rem;margin-top:.75rem}
input{flex:1;padding:.6rem;border-radius:.5rem;border:1px solid color-mix(in srgb, currentColor 25%, transparent);background:transparent;color:inherit;font:inherit}
button{padding:.6rem 1rem;border-radius:.5rem;border:0;background:currentColor;cursor:pointer}
button span{color:Canvas}
</style></head><body>
<h1>${title}</h1>
<div class="sub">channel: web · ห้อง <code id="cid"></code></div>
<div id="log"></div>
<form id="f"><input id="t" placeholder="พิมพ์ข้อความ…" autocomplete="off" autofocus><button><span>ส่ง</span></button></form>
<script>
const params = new URLSearchParams(location.search)
const cid = params.get("c") || ("room-" + Math.random().toString(36).slice(2, 10))
document.getElementById("cid").textContent = cid
const log = document.getElementById("log")
function add(cls, text){
  const d = document.createElement("div"); d.className = "m " + cls; d.textContent = text
  log.appendChild(d); log.scrollTop = log.scrollHeight
}
const es = new EventSource("/events?c=" + encodeURIComponent(cid))
es.addEventListener("ready", () => add("sys", "เชื่อมต่อแล้ว"))
es.addEventListener("message", e => { const d = JSON.parse(e.data); add(d.role === "user" ? "user" : "bot", d.text) })
es.addEventListener("done", e => { const d = JSON.parse(e.data); if (d.kind !== "answered") add("sys", "ผล: " + d.kind) })
es.onerror = () => add("sys", "การเชื่อมต่อหลุด กำลังต่อใหม่…")
document.getElementById("f").addEventListener("submit", async ev => {
  ev.preventDefault()
  const input = document.getElementById("t"); const text = input.value.trim()
  if (!text) return
  input.value = ""
  await fetch("/message", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ conversationId: cid, text }) })
})
</script></body></html>`
