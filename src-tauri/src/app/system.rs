/*
 * What's going on on the computer, so the pet can react to it:
 * - how long since the last keyboard/mouse input (away detection)
 * - which app is in front (app awareness)
 * - whether media is playing and what (music reaction)
 * - battery, CPU / memory load, internet connection, whether the PC is locked
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
    // battery percentage 0..100, or -1 when there is no battery (desktop PC)
    pub battery: i32,
    // running on mains power
    pub charging: bool,
    // whole-system CPU and memory load, 0..100
    pub cpu: f32,
    pub memory: u32,
    pub online: bool,
    // the lock screen is up
    pub locked: bool,
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
    let (battery, charging) = windows_impl::battery();
    let locked = windows_impl::locked() || app.eq_ignore_ascii_case("LockApp.exe");
    SystemStatus {
        idle_ms: windows_impl::idle_ms(),
        app,
        title,
        media: windows_impl::media().unwrap_or_default(),
        battery,
        charging,
        cpu: windows_impl::cpu(),
        memory: windows_impl::memory(),
        online: windows_impl::online(),
        locked,
    }
}

#[cfg(not(windows))]
fn read_status() -> SystemStatus {
    SystemStatus { battery: -1, online: true, ..Default::default() }
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
    use windows::Win32::Foundation::FILETIME;
    use windows::Win32::Networking::WinInet::{InternetGetConnectedState, INTERNET_CONNECTION};
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    use windows::Win32::System::StationsAndDesktops::{
        CloseDesktop, OpenInputDesktop, SwitchDesktop, DESKTOP_CONTROL_FLAGS, DESKTOP_SWITCHDESKTOP,
    };
    use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    use windows::Win32::System::Threading::GetSystemTimes;
    use std::sync::Mutex;

    // (battery %, charging); -1 % when there is no battery
    pub fn battery() -> (i32, bool) {
        unsafe {
            let mut st = SYSTEM_POWER_STATUS::default();
            if GetSystemPowerStatus(&mut st).is_err() {
                return (-1, true);
            }
            let charging = st.ACLineStatus == 1;
            // 128 = no system battery, 255 = unknown
            if st.BatteryFlag & 128 != 0 || st.BatteryLifePercent == 255 {
                return (-1, charging);
            }
            (st.BatteryLifePercent as i32, charging)
        }
    }

    pub fn memory() -> u32 {
        unsafe {
            let mut st = MEMORYSTATUSEX { dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32, ..Default::default() };
            if GlobalMemoryStatusEx(&mut st).is_ok() { st.dwMemoryLoad } else { 0 }
        }
    }

    fn ticks(t: &FILETIME) -> u64 {
        ((t.dwHighDateTime as u64) << 32) | t.dwLowDateTime as u64
    }

    // previous (idle, total) CPU time, to compute the load since the last call
    static LAST_CPU: Mutex<Option<(u64, u64)>> = Mutex::new(None);

    pub fn cpu() -> f32 {
        unsafe {
            let (mut idle, mut kernel, mut user) = (FILETIME::default(), FILETIME::default(), FILETIME::default());
            if GetSystemTimes(Some(&mut idle), Some(&mut kernel), Some(&mut user)).is_err() {
                return 0.0;
            }
            // kernel time includes idle time
            let (idle, total) = (ticks(&idle), ticks(&kernel) + ticks(&user));
            let mut last = LAST_CPU.lock().unwrap();
            let load = match *last {
                Some((li, lt)) if total > lt => {
                    let busy = (total - lt).saturating_sub(idle.saturating_sub(li));
                    100.0 * busy as f32 / (total - lt) as f32
                }
                _ => 0.0,
            };
            *last = Some((idle, total));
            load.clamp(0.0, 100.0)
        }
    }

    pub fn online() -> bool {
        unsafe {
            let mut flags = INTERNET_CONNECTION(0);
            InternetGetConnectedState(&mut flags, 0).is_ok()
        }
    }

    // the input desktop can't be switched to while the lock screen (secure desktop) is up
    pub fn locked() -> bool {
        unsafe {
            match OpenInputDesktop(DESKTOP_CONTROL_FLAGS(0), false, DESKTOP_SWITCHDESKTOP) {
                Ok(desk) => {
                    let ok = SwitchDesktop(desk).is_ok();
                    let _ = CloseDesktop(desk);
                    !ok
                }
                Err(_) => true,
            }
        }
    }

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

        // several apps can have a media session (a paused browser tab + Spotify playing...):
        // prefer one that is actually playing, otherwise fall back to the "current" one
        let mut chosen = None;
        if let Ok(sessions) = manager.GetSessions() {
            for i in 0..sessions.Size().unwrap_or(0) {
                if let Ok(s) = sessions.GetAt(i) {
                    let playing = s
                        .GetPlaybackInfo()
                        .and_then(|info| info.PlaybackStatus())
                        .map(|st| st == PlaybackStatus::Playing)
                        .unwrap_or(false);
                    if playing {
                        chosen = Some(s);
                        break;
                    }
                }
            }
        }
        let session = match chosen.or_else(|| manager.GetCurrentSession().ok()) {
            Some(s) => s,
            None => return Ok(MediaInfo::default()), // nothing playing anywhere
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

// ---------------------------------------------------------------- lock screen picture

// Sets the Windows lock screen picture. Windows may refuse this for unpackaged apps
// or when the lock screen is managed by an organisation; the error says so.
#[tauri::command]
pub async fn set_lock_screen(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || set_lock_screen_impl(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(windows)]
fn set_lock_screen_impl(path: &str) -> Result<String, String> {
    use windows::core::{Interface, HSTRING};
    use windows::Storage::{IStorageFile, StorageFile};
    use windows::System::UserProfile::{LockScreen, UserProfilePersonalizationSettings};
    use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
    unsafe {
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
    }
    let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(path))
        .and_then(|op| op.get())
        .map_err(|e| format!("couldn't open the picture: {e}"))?;
    // 1st try: the lock screen API
    let first = file
        .cast::<IStorageFile>()
        .and_then(|f| LockScreen::SetImageFileAsync(&f))
        .and_then(|op| op.get());
    if first.is_ok() {
        return Ok("lock screen updated".into());
    }
    // 2nd try: personalization settings (newer Windows versions)
    if UserProfilePersonalizationSettings::IsSupported().unwrap_or(false) {
        if let Ok(settings) = UserProfilePersonalizationSettings::Current() {
            if let Ok(true) = settings.TrySetLockScreenImageAsync(&file).and_then(|op| op.get()) {
                return Ok("lock screen updated".into());
            }
        }
    }
    Err(format!("Windows didn't allow changing the lock screen ({})", first.err().map(|e| e.message().to_string()).unwrap_or_default()))
}

#[cfg(not(windows))]
fn set_lock_screen_impl(_path: &str) -> Result<String, String> {
    Err("only supported on Windows".into())
}

// ---------------------------------------------------------------- weather

#[derive(Serialize, Default, Clone)]
pub struct Weather {
    pub place: String,
    pub temperature: f64,
    // WMO weather code (0 clear, 61 rain, 71 snow, 95 thunder…)
    pub code: i64,
    pub is_day: bool,
}

// Current weather for a city from Open-Meteo (free, no API key).
#[tauri::command]
pub async fn get_weather(city: String) -> Result<Weather, String> {
    let city = city.trim().to_string();
    if city.is_empty() {
        return Err("no city set".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let geo: serde_json::Value = serde_json::from_str(
        &client
            .get("https://geocoding-api.open-meteo.com/v1/search")
            .query(&[("name", city.as_str()), ("count", "1")])
            .send()
            .await
            .map_err(|e| e.to_string())?
            .text()
            .await
            .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let place = geo["results"].get(0).ok_or_else(|| format!("couldn't find \"{city}\""))?;
    let (lat, lon) = (place["latitude"].as_f64().unwrap_or(0.0), place["longitude"].as_f64().unwrap_or(0.0));
    let name = place["name"].as_str().unwrap_or(&city).to_string();

    let now: serde_json::Value = serde_json::from_str(
        &client
            .get("https://api.open-meteo.com/v1/forecast")
            .query(&[
                ("latitude", lat.to_string()),
                ("longitude", lon.to_string()),
                ("current", "temperature_2m,weather_code,is_day".to_string()),
            ])
            .send()
            .await
            .map_err(|e| e.to_string())?
            .text()
            .await
            .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let cur = &now["current"];
    Ok(Weather {
        place: name,
        temperature: cur["temperature_2m"].as_f64().unwrap_or(0.0),
        code: cur["weather_code"].as_i64().unwrap_or(0),
        is_day: cur["is_day"].as_i64().unwrap_or(1) == 1,
    })
}
