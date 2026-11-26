use std::path::PathBuf;
use std::process::Command;

fn swift_toolchain_usr() -> Option<PathBuf> {
    let swiftc = Command::new("xcrun")
        .args(["--find", "swiftc"])
        .output()
        .ok()?;
    if !swiftc.status.success() {
        return None;
    }
    let swiftc = PathBuf::from(String::from_utf8(swiftc.stdout).ok()?.trim());
    // Command Line Tools: /Library/Developer/CommandLineTools/usr/bin/swiftc
    // Xcode: /Applications/Xcode.app/.../Toolchains/XcodeDefault.xctoolchain/usr/bin/swiftc
    swiftc.parent()?.parent().map(|path| path.to_path_buf())
}

fn main() {
    if cfg!(target_os = "macos") {
        // Prefer the Swift runtime shipped with macOS. Command Line Tools
        // copies can create duplicate Objective-C classes at runtime.
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");

        if let Some(usr) = swift_toolchain_usr() {
            let static_libs = usr.join("lib/swift/macosx");
            if static_libs.is_dir() {
                println!("cargo:rustc-link-search=native={}", static_libs.display());
            }

            // Debug builds may run on machines with only Command Line Tools,
            // where the versioned dylibs are not in the shared cache. Release
            // builds use the macOS runtime via the /usr/lib/swift rpath above.
            if std::env::var("PROFILE").as_deref() != Ok("release") {
                if let Ok(entries) = std::fs::read_dir(usr.join("lib")) {
                    let mut paths: Vec<PathBuf> = entries
                        .flatten()
                        .map(|entry| entry.path().join("macosx"))
                        .filter(|path| path.is_dir())
                        .collect();
                    paths.sort();
                    for path in paths {
                        println!("cargo:rustc-link-arg=-Wl,-rpath,{}", path.display());
                    }
                }
            }
        }
    }

    tauri_build::build()
}
