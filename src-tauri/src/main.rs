#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().any(|a| a == "--mcp") {
        std::process::exit(constella_lib::mcp_bridge());
    }
    constella_lib::run()
}
