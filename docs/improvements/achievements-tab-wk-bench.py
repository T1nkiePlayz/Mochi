import gi, json, sys, os
gi.require_version('Gtk','3.0'); gi.require_version('WebKit2','4.1')
from gi.repository import Gtk, WebKit2, GLib
theme = sys.argv[1] if len(sys.argv)>1 else "mochi"
url = sys.argv[2] if len(sys.argv)>2 else "http://localhost:5391/"
n = int(os.environ.get("N","3"))
lib = [dict(id=f"g{i}", name=f"Game {i}", description="d", accent="#88a", artwork="", kind="game", source="custom", tofus=[dict(id=f"t{i}", name="Default", version="1", runtime="native", mods=2 if i%7==0 else 0, status="Ready")]) for i in range(58)]
init = """try{ if(!localStorage.getItem('mochi:pikos')){localStorage.setItem('mochi:pikos', %s);localStorage.setItem('mochi:setup-complete','true');localStorage.setItem('mochi:theme',%s);} }catch(e){}""" % (json.dumps(json.dumps(lib)), json.dumps(theme))
css = os.environ.get("CSS","")
if css: init += "document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent=%s;document.head.appendChild(s)});" % json.dumps(css)
ucm = WebKit2.UserContentManager()
ucm.add_script(WebKit2.UserScript(init, WebKit2.UserContentInjectedFrames.ALL_FRAMES, WebKit2.UserScriptInjectionTime.START, None, None))
ucm.register_script_message_handler("out")
win = Gtk.OffscreenWindow(); win.set_default_size(int(os.environ.get("W","1280")),int(os.environ.get("H","800")))
view = WebKit2.WebView.new_with_user_content_manager(ucm)
win.add(view); win.show_all()
results=[]
def on_msg(m, r):
    v = r.get_js_value().to_string()
    if v.startswith("RES"): print(theme, v[3:]); results.append(v)
    if v.startswith("RES") and len(results)>=n: Gtk.main_quit()
    elif v.startswith("LOG"): print(v)
ucm.connect("script-message-received::out", on_msg)
JS = """
(async()=>{
 const post=(s)=>window.webkit.messageHandlers.out.postMessage(s);
 const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
 const raf=()=>new Promise(r=>requestAnimationFrame(()=>r()));
 const b=[...document.querySelectorAll('button, a')].find(e=>/^\\s*Stats\\s*$/.test(e.textContent||'')||e.getAttribute('aria-label')==='Stats'); b&&b.click();
 for(let i=0;i<100&&!document.querySelector('.stats-view .stat-kpi');i++) await sleep(100);
 await sleep(1500);
 const tabs=()=>[...document.querySelectorAll('[role=tab]')];
 for(let k=0;k<%d;k++){
  const go=(re)=>tabs().find(t=>re.test(t.textContent));
  const t0=performance.now(); go(/Achievements/).click();
  await raf(); const t1=performance.now(); await raf(); await raf(); const t2=performance.now();
  post('RES'+JSON.stringify({badges:document.querySelectorAll('.ach-badge').length, firstFrame:Math.round(t1-t0), thirdFrame:Math.round(t2-t0)}));
  await sleep(800);
  go(/Overview/).click(); await sleep(1500);
 }
})();
""" % n
def after(v, ev):
    if ev == WebKit2.LoadEvent.FINISHED:
        GLib.timeout_add(2500, lambda: (view.evaluate_javascript(JS, -1, None, None, None, None, None), False)[1])
view.connect("load-changed", after)
s = view.get_settings(); s.set_enable_developer_extras(False)
if os.environ.get("SW"): s.set_hardware_acceleration_policy(WebKit2.HardwareAccelerationPolicy.NEVER)
GLib.timeout_add_seconds(90, Gtk.main_quit)
view.load_uri(url)
Gtk.main()
