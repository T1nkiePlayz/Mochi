use super::{DetectedImportSource, ImportedGame};
use serde_json::Value;
use std::{collections::HashSet, env, fs, path::{Path, PathBuf}, process::Command};

fn home()->PathBuf{env::var_os("HOME").map(PathBuf::from).unwrap_or_else(||PathBuf::from("."))}
fn cmd_exists(s:&str)->bool{Command::new("sh").args(["-c",&format!("command -v {s}")]).output().map(|o|o.status.success()).unwrap_or(false)}
fn flatpak(s:&str)->bool{Command::new("flatpak").args(["info",s]).output().map(|o|o.status.success()).unwrap_or(false)}
fn read(p:&Path)->Option<String>{fs::read_to_string(p).ok()}
fn json(p:&Path)->Option<Value>{serde_json::from_str(&read(p)?).ok()}
fn field<'a>(v:&'a Value,k:&[&str])->Option<&'a Value>{v.as_object().and_then(|o|k.iter().find_map(|x|o.get(*x)))}
fn string(v:&Value,k:&[&str])->Option<String>{field(v,k).and_then(Value::as_str).map(str::to_owned)}
fn enc(s:&str)->String{s.bytes().fold(String::new(),|mut o,b|{if b.is_ascii_alphanumeric()||matches!(b,b'-'|b'_'|b'.'|b'~'){o.push(b as char)}else{o.push_str(&format!("%{b:02X}"))}o})}
fn make(id:String,name:String,source:&str,target:String,path:Option<String>)->ImportedGame{ImportedGame{id,name,source:source.into(),launch_target:target,install_path:path}}
fn q(line:&str,key:&str)->Option<String>{let marker=format!("\"{key}\"");let r=line.split_once(&marker)?.1.trim().strip_prefix('\"')?;Some(r[..r.find('\"')?].replace("\\\\","\\"))}
fn steam_libs(h:&Path)->Vec<PathBuf>{let roots=[h.join(".steam/steam"),h.join(".steam/root"),h.join(".local/share/Steam"),h.join(".var/app/com.valvesoftware.Steam/.local/share/Steam")];let mut out=Vec::new();for root in roots{let a=root.join("steamapps");if !a.is_dir(){continue}if !out.contains(&a){out.push(a.clone())}if let Some(v)=read(&a.join("libraryfolders.vdf")){for l in v.lines(){if let Some(p)=q(l,"path"){let x=PathBuf::from(p).join("steamapps");if x.is_dir()&&!out.contains(&x){out.push(x)}}}}}out}
#[derive(Default)]
struct VdfNode {
    strings: std::collections::HashMap<String, String>,
    ints: std::collections::HashMap<String, i32>,
    objects: Vec<(String, VdfNode)>,
}

fn vdf_cstring(data: &[u8], start: usize) -> Option<(String, usize)> {
    let mut end = start;
    while end < data.len() && data[end] != 0 { end += 1; }
    if end >= data.len() { return None; }
    Some((String::from_utf8_lossy(&data[start..end]).replace("\\\"", "\"").replace("\\\\", "\\").to_string(), end + 1))
}

fn parse_vdf_object(data: &[u8], mut pos: usize, stop_at_end: bool) -> Option<(VdfNode, usize)> {
    let mut node = VdfNode::default();
    while pos < data.len() {
        let ty = data[pos];
        pos += 1;
        if ty == 0x08 {
            return if stop_at_end { Some((node, pos)) } else { Some((node, pos)) };
        }
        if ty != 0x00 { return None; }
        let (key, next) = vdf_cstring(data, pos)?;
        pos = next;
        if pos >= data.len() { return None; }
        match data[pos] {
            0x01 => {
                pos += 1;
                let (value, next) = vdf_cstring(data, pos)?;
                pos = next;
                node.strings.insert(key, value);
            }
            0x02 => {
                pos += 1;
                if pos + 4 > data.len() { return None; }
                let value = i32::from_le_bytes([data[pos], data[pos+1], data[pos+2], data[pos+3]]);
                pos += 4;
                node.ints.insert(key, value);
            }
            0x00 => {
                let (child, next) = parse_vdf_object(data, pos, true)?;
                pos = next;
                node.objects.push((key, child));
            }
            _ => return None,
        }
    }
    Some((node, pos))
}

fn scan_steam_shortcuts(h:&Path)->Vec<ImportedGame>{
    let userdata = h.join(".steam/steam/userdata");
    let roots = [
        h.join(".steam/steam/userdata"),
        h.join(".steam/root/userdata"),
        h.join(".local/share/Steam/userdata"),
        h.join(".var/app/com.valvesoftware.Steam/.local/share/Steam/userdata"),
    ];
    let mut out=Vec::new();
    let mut seen=HashSet::new();
    for root in roots {
        let Ok(users)=fs::read_dir(&root) else { continue };
        for user in users.flatten() {
            let path=user.path().join("config/shortcuts.vdf");
            let Ok(data)=fs::read(&path) else { continue };
            let Some((top,_))=parse_vdf_object(&data,0,false) else { continue };
            for (_,shortcut) in top.objects.iter().flat_map(|(k,v)| {
                if k == "shortcuts" { v.objects.iter() } else { [].iter() }
            }) {
                let Some(name)=shortcut.strings.get("AppName").cloned().filter(|s|!s.trim().is_empty()) else { continue };
                let appid=shortcut.ints.get("appid").map(|v| *v as i64).or_else(|| shortcut.strings.get("appid").and_then(|v|v.parse::<i64>().ok()));
                let Some(appid)=appid else { continue };
                let exe=shortcut.strings.get("Exe").cloned();
                let start_dir=shortcut.strings.get("StartDir").cloned();
                let install=exe.as_ref().and_then(|e| {
                    let p=PathBuf::from(e);
                    if p.is_file() { p.parent().map(Path::to_path_buf) } else { None }
                }).or_else(|| start_dir.as_ref().map(PathBuf::from).filter(|p|p.is_dir()));
                let key=format!("steam-shortcut:{appid}");
                if seen.insert(key.clone()) {
                    out.push(make(key,name,"steam",format!("steam://rungameid/{appid}"),install.map(|p|p.to_string_lossy().into())));
                }
            }
        }
    }
    out.sort_by_key(|g|g.name.to_lowercase());
    out
}

fn scan_steam(h:&Path)->Vec<ImportedGame>{
    let mut out=Vec::new();
    let mut seen=HashSet::new();
    for apps in steam_libs(h){
        if let Ok(es)=fs::read_dir(&apps){
            for e in es.flatten(){
                let p=e.path();
                let n=p.file_name().and_then(|x|x.to_str()).unwrap_or("");
                if !n.starts_with("appmanifest_")||p.extension().and_then(|x|x.to_str())!=Some("acf"){continue}
                let Some(t)=read(&p)else{continue};
                let id=t.lines().find_map(|l|q(l,"appid"));
                let name=t.lines().find_map(|l|q(l,"name"));
                let dir=t.lines().find_map(|l|q(l,"installdir"));
                let(Some(id),Some(name),Some(dir))=(id,name,dir)else{continue};
                let install=apps.join("common").join(dir);
                if install.is_dir()&&seen.insert(id.clone()){
                    out.push(make(format!("steam:{id}"),name,"steam",format!("steam://rungameid/{id}"),Some(install.to_string_lossy().into())))
                }
            }
        }
    }
    out.extend(scan_steam_shortcuts(h));
    let mut unique=HashSet::new();
    out.retain(|g| unique.insert(g.id.clone()));
    out.sort_by_key(|g|g.name.to_lowercase());
    out
}
fn heroic_walk(v:&Value,out:&mut Vec<ImportedGame>,seen:&mut HashSet<String>){match v{Value::Array(a)=>for x in a{heroic_walk(x,out,seen)},Value::Object(o)=>{let id=string(v,&["app_name","appName","appname","app_id","appId"]);let name=string(v,&["title","name","displayName"]);let path=string(v,&["install_path","installPath","install_location"]);let runner=string(v,&["runner"]).unwrap_or_else(||"legendary".into());if let(Some(id),Some(name),Some(path))=(id,name,path){if Path::new(&path).is_dir(){let key=format!("heroic:{runner}:{id}");if seen.insert(key.clone()){out.push(make(key,name,"heroic",format!("heroic://launch?appName={}&runner={}",enc(&id),enc(&runner)),Some(path)))}}}for x in o.values(){heroic_walk(x,out,seen)}},_=>{}}}
fn scan_heroic(h:&Path)->Vec<ImportedGame>{let mut out=Vec::new();let mut seen=HashSet::new();for root in[h.join(".config/heroic"),h.join(".var/app/com.heroicgameslauncher.hgl/config/heroic")]{if !root.is_dir(){continue}if let Some(v)=json(&root.join("legendaryConfig/legendary/installed.json")){heroic_walk(&v,&mut out,&mut seen)}let d=root.join("GamesConfig");if let Ok(es)=fs::read_dir(d){for e in es.flatten(){if e.path().extension().and_then(|x|x.to_str())==Some("json"){if let Some(v)=json(&e.path()){heroic_walk(&v,&mut out,&mut seen)}}}}}out.sort_by_key(|g|g.name.to_lowercase());out}
fn scan_lutris()->Vec<ImportedGame>{let mut c=if cmd_exists("lutris"){Command::new("lutris")}else if flatpak("net.lutris.Lutris"){let mut c=Command::new("flatpak");c.args(["run","net.lutris.Lutris"]);c}else{return Vec::new()};c.args(["--list-games","--json"]);let Ok(o)=c.output()else{return Vec::new()};if !o.status.success(){return Vec::new()}let s=String::from_utf8_lossy(&o.stdout);let Ok(Value::Array(a))=serde_json::from_str::<Value>(&s[s.find('[').unwrap_or(0)..])else{return Vec::new()};let mut out=Vec::new();for v in a{let Some(id)=field(&v,&["id"]).and_then(Value::as_i64)else{continue};let Some(name)=string(&v,&["name","title"])else{continue};out.push(make(format!("lutris:{id}"),name,"lutris",format!("lutris:rungameid/{id}"),string(&v,&["directory","path"])))}out.sort_by_key(|g|g.name.to_lowercase());out}
fn bottles_cmd(a:&[&str])->Option<Command>{if cmd_exists("bottles-cli"){let mut c=Command::new("bottles-cli");c.args(a);Some(c)}else if flatpak("com.usebottles.bottles"){let mut c=Command::new("flatpak");c.args(["run","--command=bottles-cli","com.usebottles.bottles"]);c.args(a);Some(c)}else{None}}
fn scan_bottles()->Vec<ImportedGame>{let Some(mut l)=bottles_cmd(&["list","bottles"])else{return Vec::new()};let Ok(o)=l.output()else{return Vec::new()};if !o.status.success(){return Vec::new()}let mut out=Vec::new();for line in String::from_utf8_lossy(&o.stdout).lines(){let b=line.trim().strip_prefix("- ").unwrap_or("").trim();if b.is_empty(){continue}let Some(mut c)=bottles_cmd(&["--json","programs","-b",b])else{continue};let Ok(o)=c.output()else{continue};let Ok(v)=serde_json::from_slice::<Value>(&o.stdout)else{continue};let items=match v{Value::Array(a)=>a,Value::Object(o)=>o.get("programs").and_then(Value::as_array).cloned().unwrap_or_default(),_=>Vec::new()};for p in items{let Some(name)=string(&p,&["name","title"])else{continue};let program=string(&p,&["name","executable"]).unwrap_or_else(||name.clone());out.push(make(format!("bottles:{b}:{program}"),name,"bottles",format!("bottles:run/{}/{}",enc(b),enc(&program)),string(&p,&["path"])))}}out.sort_by_key(|g|g.name.to_lowercase());out}
fn receipts(root:&Path,d:usize,out:&mut Vec<PathBuf>){if d>5||!root.is_dir(){return}if let Ok(es)=fs::read_dir(root){for e in es.flatten(){let p=e.path();if p.is_dir(){receipts(&p,d+1,out)}else if p.file_name().and_then(|x|x.to_str())==Some("receipt.json.gz"){out.push(p)}}}}
fn scan_itch(h:&Path)->Vec<ImportedGame>{let mut rs=Vec::new();for r in[h.join(".config/itch"),h.join("Games"),h.join(".local/share/itch")]{receipts(&r,0,&mut rs)}let mut out=Vec::new();let mut seen=HashSet::new();for r in rs{let Ok(o)=Command::new("gzip").arg("-cd").arg(&r).output()else{continue};let Ok(v)=serde_json::from_slice::<Value>(&o.stdout)else{continue};let id=field(&v,&["game_id","gameId"]).and_then(Value::as_i64).or_else(||field(&v,&["game"]).and_then(|x|field(x,&["id"]).and_then(Value::as_i64)));let Some(id)=id else{continue};let id=id.to_string();if !seen.insert(id.clone()){continue}let name=field(&v,&["game"]).and_then(|x|string(x,&["title","name"])).or_else(||string(&v,&["title","name"])).unwrap_or_else(||"itch.io game".into());out.push(make(format!("itch:{id}"),name,"itch",format!("itch://run-game/{id}"),r.parent().and_then(Path::parent).map(|p|p.to_string_lossy().into())))}out.sort_by_key(|g|g.name.to_lowercase());out}
pub fn detect_import_sources()->Vec<DetectedImportSource>{let h=home();let f=super::super::platform::list_flatpaks().map(|a|a.into_iter().filter(|x|x.category=="Games").count()).unwrap_or(0);let a=scan_steam(&h);let b=scan_heroic(&h);let c=scan_lutris();let d=scan_bottles();let e=scan_itch(&h);vec![DetectedImportSource{id:"flatpak".into(),name:"Flatpak".into(),description:"Installed games delivered through Flatpak.".into(),detected:f>0||cmd_exists("flatpak"),game_count:Some(f as u32)},DetectedImportSource{id:"steam".into(),name:"Steam".into(),description:"Games installed through Steam and its libraries.".into(),detected:!a.is_empty()||cmd_exists("steam")||flatpak("com.valvesoftware.Steam"),game_count:Some(a.len() as u32)},DetectedImportSource{id:"heroic".into(),name:"Heroic Games Launcher".into(),description:"Epic, GOG and Amazon games managed by Heroic.".into(),detected:!b.is_empty()||cmd_exists("heroic")||flatpak("com.heroicgameslauncher.hgl"),game_count:Some(b.len() as u32)},DetectedImportSource{id:"lutris".into(),name:"Lutris".into(),description:"Existing Lutris games and launch configurations.".into(),detected:!c.is_empty()||cmd_exists("lutris")||flatpak("net.lutris.Lutris"),game_count:Some(c.len() as u32)},DetectedImportSource{id:"bottles".into(),name:"Bottles".into(),description:"Windows games and applications inside Bottles.".into(),detected:!d.is_empty()||cmd_exists("bottles-cli")||flatpak("com.usebottles.bottles"),game_count:Some(d.len() as u32)},DetectedImportSource{id:"itch".into(),name:"itch.io".into(),description:"Games installed with the itch desktop app.".into(),detected:!e.is_empty()||cmd_exists("itch-setup")||h.join(".itch").exists(),game_count:Some(e.len() as u32)}]}
fn scan_steam_path(path:&Path)->Vec<ImportedGame>{
    let root=if path.file_name().and_then(|x|x.to_str())==Some("steamapps"){path.to_path_buf()}else{path.join("steamapps")};
    let mut out=Vec::new();
    if let Ok(es)=fs::read_dir(&root){
        for e in es.flatten(){
            let p=e.path();
            let n=p.file_name().and_then(|x|x.to_str()).unwrap_or("");
            if !n.starts_with("appmanifest_")||p.extension().and_then(|x|x.to_str())!=Some("acf"){continue}
            if let Some(t)=read(&p){
                let id=t.lines().find_map(|l|q(l,"appid"));
                let name=t.lines().find_map(|l|q(l,"name"));
                let dir=t.lines().find_map(|l|q(l,"installdir"));
                if let(Some(id),Some(name),Some(dir))=(id,name,dir){
                    out.push(make(format!("steam:{id}"),name,"steam",format!("steam://rungameid/{id}"),Some(root.join("common").join(dir).to_string_lossy().into())))
                }
            }
        }
    }
    out.sort_by_key(|g|g.name.to_lowercase());
    out
}
pub fn scan_import_games(source:&str,library_path:Option<String>)->Vec<ImportedGame>{let h=home();match source{"flatpak"=>super::super::platform::list_flatpaks().unwrap_or_default().into_iter().filter(|a|a.category=="Games").map(|a|make(format!("flatpak:{}",a.id),a.name,"flatpak",format!("flatpak://{}",a.id),None)).collect(),"steam"=>library_path.as_deref().map(|p|scan_steam_path(Path::new(p))).unwrap_or_else(||scan_steam(&h)),"heroic"=>library_path.as_deref().map(|p|scan_heroic(Path::new(p))).unwrap_or_else(||scan_heroic(&h)),"lutris"=>scan_lutris(),"bottles"=>scan_bottles(),"itch"=>library_path.as_deref().map(|p|scan_itch(Path::new(p))).unwrap_or_else(||scan_itch(&h)),_=>Vec::new()}}
