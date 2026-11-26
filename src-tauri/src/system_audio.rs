//! System audio capture via macOS ScreenCaptureKit.
//!
//! The stream is video-less: we only subscribe to the Audio output type and
//! forward small mono PCM chunks to the frontend as base64-encoded i16.
//! The frontend runs the actual "is this music?" classification.

use base64::Engine;
use screencapturekit::cm::CMSampleBuffer;
use screencapturekit::prelude::*;
use screencapturekit::stream::delegate_trait::StreamCallbacks;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

pub const SYSTEM_AUDIO_EVENT: &str = "system-audio-chunk";
const SAMPLE_RATE: i32 = 24_000;
const CHUNK_SAMPLES: usize = 2_400; // 100 ms at 24 kHz

#[derive(Default)]
pub struct SystemAudioState {
    pub stream: Mutex<Option<SCStream>>,
    pub running: AtomicBool,
    pub last_error: Mutex<Option<String>>,
    pub chunks: Arc<AtomicU64>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SystemAudioStatus {
    running: bool,
    error: Option<String>,
    chunks: u64,
    sample_rate: i32,
}

struct AudioHandler {
    app: AppHandle,
    pending: Arc<Mutex<Vec<i16>>>,
    last_error: Arc<Mutex<Option<String>>>,
    chunks: Arc<AtomicU64>,
}

fn decode_sample_buffer(sample: &CMSampleBuffer) -> Result<Vec<f32>, String> {
    let list = sample
        .audio_buffer_list()
        .map_err(|error| format!("Не удалось прочитать аудиобуфер: {error}"))?;

    let channels: Vec<Vec<f32>> = list
        .iter()
        .map(|buffer| {
            buffer
                .data()
                .chunks_exact(4)
                .map(|bytes| {
                    f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
                })
                .collect()
        })
        .collect();

    if channels.is_empty() {
        return Ok(Vec::new());
    }

    // Planar buffers (one buffer per channel) are averaged; interleaved data
    // is handled per buffer using its own channel count.
    if channels.len() > 1 {
        let frames = channels.iter().map(Vec::len).min().unwrap_or(0);
        return Ok((0..frames)
            .map(|index| {
                let sum: f32 = channels.iter().map(|channel| channel[index]).sum();
                sum / channels.len() as f32
            })
            .collect());
    }

    let buffer = &list.get(0).expect("checked above");
    let count = buffer.number_channels.max(1) as usize;
    let samples = &channels[0];
    if count == 1 {
        return Ok(samples.clone());
    }
    Ok(samples
        .chunks(count)
        .map(|frame| frame.iter().sum::<f32>() / count as f32)
        .collect())
}

impl SCStreamOutputTrait for AudioHandler {
    fn did_output_sample_buffer(&self, sample: CMSampleBuffer, output_type: SCStreamOutputType) {
        if output_type != SCStreamOutputType::Audio {
            return;
        }

        let samples = match decode_sample_buffer(&sample) {
            Ok(samples) => samples,
            Err(error) => {
                *self.last_error.lock().expect("audio error lock") = Some(error);
                return;
            }
        };

        let mut pending = self.pending.lock().expect("audio pending lock");
        for value in samples {
            let clamped = value.clamp(-1.0, 1.0);
            pending.push((clamped * 32767.0) as i16);
        }

        while pending.len() >= CHUNK_SAMPLES {
            let chunk: Vec<i16> = pending.drain(..CHUNK_SAMPLES).collect();
            let mut bytes = Vec::with_capacity(chunk.len() * 2);
            for value in &chunk {
                bytes.extend_from_slice(&value.to_le_bytes());
            }
            let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
            drop(pending);
            if let Err(error) = self.app.emit(SYSTEM_AUDIO_EVENT, encoded) {
                eprintln!("Не удалось отправить аудиочанк: {error}");
            }
            self.chunks.fetch_add(1, Ordering::Relaxed);
            pending = self.pending.lock().expect("audio pending lock");
        }
    }
}

#[tauri::command]
pub fn start_system_audio(
    app: AppHandle,
    state: State<'_, SystemAudioState>,
) -> Result<(), String> {
    if state.running.load(Ordering::Relaxed) {
        return Ok(());
    }

    let content = SCShareableContent::get().map_err(|error| error.to_string())?;
    let display = content
        .displays()
        .into_iter()
        .next()
        .ok_or_else(|| "Дисплей не найден".to_string())?;

    let filter = SCContentFilter::create()
        .with_display(&display)
        .with_excluding_windows(&[])
        .build()
        .map_err(|error| error.to_string())?;

    let config = SCStreamConfiguration::new()
        .with_width(1)
        .with_height(1)
        .with_captures_audio(true)
        .with_excludes_current_process_audio(true)
        .with_sample_rate(SAMPLE_RATE)
        .with_channel_count(1);

    let error_state = Arc::new(Mutex::new(None::<String>));
    let running = Arc::new(AtomicBool::new(true));
    let delegate_error = error_state.clone();
    let delegate_running = running.clone();
    let delegate = StreamCallbacks::new().on_error(move |error| {
        *delegate_error.lock().expect("delegate error lock") = Some(error.to_string());
        delegate_running.store(false, Ordering::Relaxed);
    });

    let mut stream = SCStream::new_with_delegate(&filter, &config, delegate)
        .map_err(|error| error.to_string())?;

    let pending = Arc::new(Mutex::new(Vec::<i16>::with_capacity(CHUNK_SAMPLES * 2)));
    let handler = AudioHandler {
        app: app.clone(),
        pending: pending.clone(),
        last_error: error_state.clone(),
        chunks: state.chunks.clone(),
    };
    stream
        .add_output_handler(handler, SCStreamOutputType::Audio)
        .map_err(|error| error.to_string())?;

    stream.start_capture().map_err(|error| error.to_string())?;

    *state.stream.lock().expect("audio stream lock") = Some(stream);
    *state.last_error.lock().expect("audio error lock") = error_state
        .lock()
        .expect("delegate error lock")
        .clone();
    state.running.store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub fn stop_system_audio(state: State<'_, SystemAudioState>) -> Result<(), String> {
    let stream = state.stream.lock().expect("audio stream lock").take();
    if let Some(stream) = stream {
        stream.stop_capture().map_err(|error| error.to_string())?;
    }
    state.running.store(false, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub fn system_audio_status(state: State<'_, SystemAudioState>) -> SystemAudioStatus {
    SystemAudioStatus {
        running: state.running.load(Ordering::Relaxed),
        error: state.last_error.lock().expect("audio error lock").clone(),
        chunks: state.chunks.load(Ordering::Relaxed),
        sample_rate: SAMPLE_RATE,
    }
}
