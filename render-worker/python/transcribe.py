#!/usr/bin/env python3
import json
import os
import sys
import tempfile
import wave

from funasr_onnx import Paraformer


def transcribe_in_chunks(model, audio_path, chunk_seconds):
    text_parts = []
    timestamps = []
    with wave.open(audio_path, "rb") as source:
        sample_rate = source.getframerate()
        chunk_frames = max(1, sample_rate * chunk_seconds)
        offset_ms = 0
        with tempfile.TemporaryDirectory(prefix="funasr-chunks-") as temp_dir:
            index = 0
            while True:
                frames = source.readframes(chunk_frames)
                if not frames:
                    break
                chunk_path = os.path.join(temp_dir, f"chunk-{index:04d}.wav")
                with wave.open(chunk_path, "wb") as chunk:
                    chunk.setparams(source.getparams())
                    chunk.writeframes(frames)
                result = model(chunk_path)
                first = result[0] if result else {}
                text = first.get("preds") or first.get("text") or ""
                text_parts.append("".join(str(text).split()))
                for pair in first.get("timestamp") or first.get("timestamps") or []:
                    if isinstance(pair, (list, tuple)) and len(pair) >= 2:
                        timestamps.append([int(pair[0]) + offset_ms, int(pair[1]) + offset_ms])
                frame_count = len(frames) // max(1, source.getsampwidth() * source.getnchannels())
                offset_ms += round(frame_count * 1000 / sample_rate)
                index += 1
    return "".join(text_parts), timestamps


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: transcribe.py input.wav output.json")
    audio_path, output_path = sys.argv[1], sys.argv[2]
    model_dir = os.environ.get(
        "FUNASR_MODEL_DIR",
        "damo/speech_paraformer-large-vad-punc_asr_nat-zh-cn-16k-common-vocab8404-onnx",
    )
    # The PyTorch Paraformer model can be killed by the OOM guard on a 2C4G
    # worker. The official quantized ONNX runtime keeps peak RSS below 1 GB on
    # our production sample while preserving character-level timestamps.
    model = Paraformer(
        model_dir,
        batch_size=1,
        quantize=True,
        intra_op_num_threads=max(1, int(os.environ.get("FUNASR_CPU_THREADS", "2"))),
    )
    text, timestamps = transcribe_in_chunks(
        model,
        audio_path,
        max(15, int(os.environ.get("FUNASR_CHUNK_SECONDS", "60"))),
    )
    payload = {
        "text": text,
        "timestamp": timestamps,
        "sentence_info": [],
    }
    with open(output_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False)


if __name__ == "__main__":
    main()
