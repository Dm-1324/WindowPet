use super::utils::{open_setting_window, reopen_main_window};
use log::info;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    AppHandle, CustomMenuItem, Manager, SystemTray, SystemTrayEvent, SystemTrayMenu,
    SystemTrayMenuItem,
};

// pets hidden with "Hide pets" / Ctrl+Alt+X (the window keeps running, just invisible)
static PETS_HIDDEN: AtomicBool = AtomicBool::new(false);

// hides or shows the pet overlay without closing it; returns true when the pets are now visible
pub fn toggle_pets(app: &AppHandle) -> bool {
    let hide = !PETS_HIDDEN.load(Ordering::SeqCst);
    set_pets_hidden(app, hide);
    !hide
}

pub fn set_pets_hidden(app: &AppHandle, hide: bool) {
    PETS_HIDDEN.store(hide, Ordering::SeqCst);
    if let Some(window) = app.get_window("main") {
        // tell the pets first so they can pause / say hi
        let _ = window.emit("pets-visibility", !hide);
        if hide {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_ignore_cursor_events(true);
        }
    }
    let _ = app
        .tray_handle()
        .get_item("hide")
        .set_title(if hide { "Show pets 🙉" } else { "Hide pets 🙈 (Ctrl+Alt+X)" });
    info!("Pets {}", if hide { "hidden" } else { "shown" });
}

// for the keyboard shortcut in the pet overlay
#[tauri::command]
pub fn toggle_pets_visibility(app: AppHandle) -> bool {
    toggle_pets(&app)
}

pub fn init_system_tray() -> SystemTray {
    let menu = SystemTrayMenu::new()
        .add_item(CustomMenuItem::new("hide".to_string(), "Hide pets 🙈 (Ctrl+Alt+X)"))
        .add_item(CustomMenuItem::new("show".to_string(), "Show"))
        .add_item(CustomMenuItem::new(
            "pause".to_string(),
            "Pause (Free Memory)",
        ))
        .add_item(CustomMenuItem::new("setting".to_string(), "Setting"))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(CustomMenuItem::new("restart".to_string(), "Restart"))
        .add_item(CustomMenuItem::new("quit".to_string(), "Quit"));

    SystemTray::new().with_menu(menu)
}

pub fn handle_tray_event(app: &AppHandle, event: SystemTrayEvent) {
    if let SystemTrayEvent::MenuItemClick { id, .. } = event {
        match id.as_str() {
            "hide" => {
                toggle_pets(app);
            }
            "show" => {
                // hidden? just bring them back
                if PETS_HIDDEN.load(Ordering::SeqCst) {
                    set_pets_hidden(app, false);
                    return;
                }
                match app.get_window("main") {
                    Some(window) => {
                        println!("Window already exists");
                        tauri::api::dialog::message(
                            Some(&window),
                            "WindowPet Dialog",
                            "Pet already exist",
                        );
                    }
                    None => {
                        // use tokio to run the future to avoid blocking the thread
                        let future = async { reopen_main_window(app.clone()).await };
                        // run the future using an executor and handle the result
                        let _result_ = tokio::runtime::Runtime::new().unwrap().block_on(future);
                    }
                };
            }
            "pause" => {
                match app.get_window("main") {
                    Some(window) => {
                        window.close().expect("failed to close frontend window");
                    }
                    None => {
                        println!("Window not found");
                    }
                };
            }
            "setting" => match app.get_window("setting") {
                Some(window) => {
                    tauri::api::dialog::message(
                        Some(&window),
                        "WindowPet Dialog",
                        "WindowPet setting already exist",
                    );
                    println!("Window setting already exist");
                }
                None => {
                    open_setting_window(app.clone());
                }
            },
            "restart" => {
                info!("Restart WindowPet");
                app.restart();
            }
            "quit" => {
                info!("Quit WindowPet");
                app.exit(0);
            }
            _ => {}
        }
    } else if let SystemTrayEvent::DoubleClick {
        position: _,
        size: _,
        ..
    } = event
    {
        match app.get_window("setting") {
            Some(window) => {
                tauri::api::dialog::message(
                    Some(&window),
                    "WindowPet Dialog",
                    "WindowPet setting already exist",
                );
                println!("Window setting already exists");
            }
            None => {
                open_setting_window(app.clone());
            }
        }
    }
}
