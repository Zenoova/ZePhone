// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `zephone ctl …` talks to the application that is already open and exits: it never starts a second one.
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("ctl") {
        std::process::exit(zephone_lib::control::cli::run(&args[1..]));
    }
    zephone_lib::run()
}
