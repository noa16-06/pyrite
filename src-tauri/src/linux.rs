//! Every distribution pairs Pyrite with a different WebKitGTK build and graphics
//! stack, and a couple of those combinations need a nudge before GTK starts.

use std::env;
use std::path::Path;

/// WebKitGTK 2.42+ composites through DMA-BUF, which hands back a blank or black
/// window on the proprietary NVIDIA driver and under software GL (VMs, remote
/// sessions). Turning the renderer off costs a little drawing performance, so it
/// only happens where the window would otherwise be unusable.
///
/// The variable has to be set before GTK initialises, and an explicit setting
/// from the user always wins.
pub fn prepare() {
    if env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() && dmabuf_is_broken() {
        env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
}

fn dmabuf_is_broken() -> bool {
    // Only the proprietary driver registers this; nouveau and the Mesa stack
    // handle DMA-BUF fine.
    if Path::new("/sys/module/nvidia").is_dir() {
        return true;
    }
    let always_software = env::var("LIBGL_ALWAYS_SOFTWARE").ok();
    let gallium = env::var("GALLIUM_DRIVER").ok();
    software_gl(always_software.as_deref(), gallium.as_deref())
}

fn software_gl(always_software: Option<&str>, gallium: Option<&str>) -> bool {
    always_software.is_some_and(|v| !matches!(v, "" | "0" | "false"))
        || matches!(gallium, Some("llvmpipe" | "softpipe" | "swrast"))
}

#[cfg(test)]
mod tests {
    use super::software_gl;

    #[test]
    fn detects_software_rendering() {
        assert!(software_gl(Some("1"), None));
        assert!(software_gl(Some("true"), None));
        assert!(software_gl(None, Some("llvmpipe")));
    }

    #[test]
    fn leaves_hardware_rendering_alone() {
        assert!(!software_gl(None, None));
        assert!(!software_gl(Some("0"), Some("radeonsi")));
        assert!(!software_gl(Some(""), None));
    }
}
