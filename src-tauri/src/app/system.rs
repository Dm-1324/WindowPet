/*
 * What's going on on the computer, so the pet can react to it:
 * - how long since the last keyboard/mouse input (away detection)
 * - which app is in front (app awareness)
 * - whether media is playing and what (music reaction)
 *
 * Everything is read locally on demand and only handed to the pet overlay;
 * nothing is stored or sent anywhere.
 */
use serde::Serialize;

#[derive(Serialize, Default, Clone)]
pub struct MediaInfo {
    pub playing: bool,
    pub title: String,
    pub artist: String,
    pub app: String,
}

#[derive(Serialize, Default, Clone)]
pub struct SystemStatus {
    // milliseconds since the last keyboard / mouse input
    pub idle_ms: u64,
    // executable name of the foreground app, e.g. "code.exe"
    pub app: String,
    // title of the foreground window
    pub title: String,
    pub media: MediaInfo,
}

#[tauri::command]
pub async fn get_system_status() -> SystemStatus {
    // the Windows media API is async/COM based: keep it off the main thread
    tauri::async_runtime::spawn_blocking(read_status)
        .await
        .unwrap_or_default()
}

#[cfg(windows)]
fn read_status() -> SystemStatus {
    let (app, title) = windows_impl::foreground_app();
    SystemStatus {
        idle_ms: windows_impl::idle_ms(),
        app,
        title,
        media: windows_impl::media().unwrap_or_default(),
    }
}

#[cfg(not(windows))]
fn read_status() -> SystemStatus {
    SystemStatus::default()
}

#[cfg(windows)]
mod windows_impl {
    use super::MediaInfo;
    use windows::core::PWSTR;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager as SessionManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
    };
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
    };

    pub fn idle_ms() -> u64 {
        unsafe {
            let mut info = LASTINPUTINFO {
                cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
                dwTime: 0,
            };
            if !GetLastInputInfo(&mut info).as_bool() {
                return 0;
            }
            // both are tick counts that wrap around together
            GetTickCount().wrapping_sub(info.dwTime) as u64
        }
    }

    pub fn foreground_app() -> (String, String) {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.0.is_null() {
                return (String::new(), String::new());
            }

            let mut title_buf = [0u16; 512];
            let len = GetWindowTextW(hwnd, &mut title_buf);
            let title = String::from_utf16_lossy(&title_buf[..len.max(0) as usize]);

            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            let mut app = String::new();
            if pid != 0 {
                if let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                    let mut buf = [0u16; 1024];
                    let mut size = buf.len() as u32;
                    if QueryFullProcessImageNameW(
                        handle,
                        PROCESS_NAME_WIN32,
                        PWSTR(buf.as_mut_ptr()),
                        &mut size,
                    )
                    .is_ok()
                    {
                        let path = String::from_utf16_lossy(&buf[..size as usize]);
                        app = path.rsplit('\\').next().unwrap_or("").to_string();
                    }
                    let _ = CloseHandle(handle);
                }
            }
            (app, title)
        }
    }

    pub fn media() -> windows::core::Result<MediaInfo> {
        unsafe {
            // fine if this thread was already initialised
            let _ = RoInitialize(RO_INIT_MULTITHREADED);
        }
        let manager = SessionManager::RequestAsync()?.get()?;
        let session = match manager.GetCurrentSession() {
            Ok(s) => s,
            Err(_) => return Ok(MediaInfo::default()), // nothing playing anywhere
        };
        let playing = session.GetPlaybackInfo()?.PlaybackStatus()? == PlaybackStatus::Playing;
        let props = session.TryGetMediaPropertiesAsync()?.get()?;
        Ok(MediaInfo {
            playing,
            title: props.Title().map(|s| s.to_string()).unwrap_or_default(),
            artist: props.Artist().map(|s| s.to_string()).unwrap_or_default(),
            app: session
                .SourceAppUserModelId()
                .map(|s| s.to_string())
                .unwrap_or_default(),
        })
    }
}
