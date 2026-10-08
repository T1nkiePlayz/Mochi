//! LaunchAgent (start at login) property list for macOS. Pure text generation so the
//! content can be unit-tested on any OS.

use std::path::Path;

fn xml_escape(value: &str) -> String {
    value.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// The `.app` bundle that contains `exe` (`/Applications/Mochi.app/Contents/MacOS/mochi` -> `/Applications/Mochi.app`).
pub fn bundle_of(exe: &Path) -> Option<&Path> {
    let macos_dir = exe.parent()?;
    let contents = macos_dir.parent()?;
    let bundle = contents.parent()?;
    let is_bundle = macos_dir.file_name()? == "MacOS" && contents.file_name()? == "Contents" && bundle.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("app"));
    is_bundle.then_some(bundle)
}

/// Programs and arguments for the agent. A bundle is started through `open` so the app is
/// launched like a normal Dock/Finder launch (and a login item that exits does not matter);
/// a bare executable (development builds) is started directly.
pub fn program_arguments(exe: &Path) -> Result<Vec<String>, String> {
    let text = |path: &Path| path.to_str().map(str::to_owned).ok_or_else(|| "The Mochi location contains characters that cannot be used for a login item.".to_string());
    // A quarantined app opened straight from Downloads or a mounted DMG runs from a temporary,
    // randomised location that disappears; registering it would silently break at the next login.
    let lossy = exe.to_string_lossy();
    if lossy.contains("/AppTranslocation/") || lossy.starts_with("/Volumes/") {
        return Err("Move Mochi to your Applications folder first, then turn on \"Start with Mochi at login\".".into());
    }
    match bundle_of(exe) {
        Some(bundle) => Ok(vec!["/usr/bin/open".into(), "-a".into(), text(bundle)?, "--args".into(), "--autostart".into()]),
        None => Ok(vec![text(exe)?, "--autostart".into()]),
    }
}

pub fn plist(label: &str, arguments: &[String]) -> String {
    let items: String = arguments.iter().map(|argument| format!("<string>{}</string>", xml_escape(argument))).collect::<Vec<_>>().join("");
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>{}</string>
<key>ProgramArguments</key><array>{items}</array>
<key>RunAtLoad</key><true/>
<key>ProcessType</key><string>Interactive</string>
</dict></plist>
"#,
        xml_escape(label)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundles_start_through_open() {
        let args = program_arguments(Path::new("/Applications/Mochi.app/Contents/MacOS/mochi")).unwrap();
        assert_eq!(args, ["/usr/bin/open", "-a", "/Applications/Mochi.app", "--args", "--autostart"]);
        let user = program_arguments(Path::new("/Users/me/Applications/My Games & More/Mochi.app/Contents/MacOS/mochi")).unwrap();
        assert_eq!(user[2], "/Users/me/Applications/My Games & More/Mochi.app");
    }

    #[test]
    fn plain_executables_start_directly() {
        assert_eq!(program_arguments(Path::new("/opt/dev/target/debug/mochi")).unwrap(), ["/opt/dev/target/debug/mochi", "--autostart"]);
    }

    #[test]
    fn translocated_and_mounted_apps_are_refused() {
        assert!(program_arguments(Path::new("/private/var/folders/x/T/AppTranslocation/ABC/d/Mochi.app/Contents/MacOS/mochi")).is_err());
        assert!(program_arguments(Path::new("/Volumes/Mochi/Mochi.app/Contents/MacOS/mochi")).is_err());
    }

    #[test]
    fn plist_is_escaped_and_well_formed() {
        let text = plist("dev.example.Mochi", &["/a/<b>&\"c\"".to_string(), "--autostart".to_string()]);
        assert!(text.contains("<string>/a/&lt;b&gt;&amp;&quot;c&quot;</string>"));
        assert!(text.contains("<key>RunAtLoad</key><true/>"));
        assert!(!text.contains("KeepAlive"));
        assert_eq!(text.matches("<string>").count(), text.matches("</string>").count());
    }
}
