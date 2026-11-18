//! The audio route of a call on a phone.
//!
//! The engine only opens the microphone and the loudspeaker; it is Android that decides where a conversation is
//! heard. A call must put the system in "communication" mode (the earpiece, the hardware echo canceller, the call
//! volume) and bring it back to normal afterwards, or the music of the other applications would play through the
//! earpiece. Nothing to do on a computer.

#[cfg(target_os = "android")]
mod imp {
    use jni::{
        JNIEnv, JavaVM,
        objects::{JObject, JValue},
    };

    /// `AudioManager.MODE_NORMAL` and `AudioManager.MODE_IN_COMMUNICATION`.
    const MODE_NORMAL: i32 = 0;
    const MODE_IN_COMMUNICATION: i32 = 3;

    /// Runs `f` with the system's `AudioManager`.
    fn with_audio_manager<R>(
        f: impl FnOnce(&mut JNIEnv, &JObject) -> jni::errors::Result<R>,
    ) -> Result<R, String> {
        let ctx = ndk_context::android_context();
        // SAFETY: both pointers come from the Android runtime (through `ndk-context`) and live as long as the
        // process; the context is a global reference we only borrow (a `JObject` never frees it).
        let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) }.map_err(|e| e.to_string())?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        let context = unsafe { JObject::from_raw(ctx.context().cast()) };
        let run = |env: &mut JNIEnv| -> jni::errors::Result<R> {
            let name = env.new_string("audio")?;
            let manager = env
                .call_method(
                    &context,
                    "getSystemService",
                    "(Ljava/lang/String;)Ljava/lang/Object;",
                    &[JValue::Object(&name)],
                )?
                .l()?;
            f(env, &manager)
        };
        let result = run(&mut env);
        if result.is_err() && env.exception_check().unwrap_or(false) {
            let _ = env.exception_clear();
        }
        result.map_err(|e| e.to_string())
    }

    fn set_mode(mode: i32) -> Result<(), String> {
        with_audio_manager(|env, manager| {
            env.call_method(manager, "setMode", "(I)V", &[JValue::Int(mode)])
                .map(|_| ())
        })
    }

    pub fn set_in_call(in_call: bool) {
        if in_call {
            if let Err(e) = set_mode(MODE_IN_COMMUNICATION) {
                log::warn!("cannot switch the phone to communication mode: {e}");
            }
        } else {
            // Back to a phone at rest: normal mode, and the loudspeaker is not kept for the next call.
            let _ = set_speakerphone(false);
            if let Err(e) = set_mode(MODE_NORMAL) {
                log::warn!("cannot restore the phone's audio mode: {e}");
            }
        }
    }

    pub fn set_speakerphone(on: bool) -> Result<(), String> {
        with_audio_manager(|env, manager| {
            env.call_method(
                manager,
                "setSpeakerphoneOn",
                "(Z)V",
                &[JValue::Bool(on.into())],
            )
            .map(|_| ())
        })
    }
}

#[cfg(not(target_os = "android"))]
mod imp {
    pub fn set_in_call(_in_call: bool) {}

    pub fn set_speakerphone(_on: bool) -> Result<(), String> {
        Ok(())
    }
}

pub use imp::{set_in_call, set_speakerphone};
