#!/usr/bin/env bash
set -euo pipefail
run_dir="${1:?Usage: love-travel-voice.sh RUN_DIR}"
scenario="${2:-examples/love-travel-ai-booking-experience.json}"
python3 -m pip install --quiet edge-tts
RUN_DIR="$run_dir" SCENARIO="$scenario" node --input-type=module <<'NODE'
import fs from 'node:fs';
const scenario=JSON.parse(fs.readFileSync(process.env.SCENARIO,'utf8'));
const narration=scenario.steps.map(step=>String(step.voiceText||step.narration||'').trim()).filter(Boolean).join(' ');
fs.writeFileSync(process.env.RUN_DIR+'/narration.txt',narration+'\n');
console.log('NARRATION_WORDS',narration.split(/\s+/).length);
NODE
edge-tts --voice en-US-AriaNeural --rate=+3% --pitch=+0Hz --file "$run_dir/narration.txt" --write-media "$run_dir/voiceover.mp3"
test -s "$run_dir/voiceover.mp3"
ffprobe -v error -show_entries format=duration -of csv=p=0 "$run_dir/voiceover.mp3"
