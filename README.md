# 🎧 LISTEN — the synth your agent can hear

> **You bring the taste. The agent measures, adjusts, and proves the result.** A Web Audio synthesizer your AI agent can actually *hear* — it reads structured acoustic features from its own output in real time, designs sound with you by ear, and hands you production-ready artifacts (a DAW preset, a WAV, a recipe). **Sound design for people who don't want to learn 30 knobs.**

Built for **The WebMCP Challenge** (Devpost). Vanilla JS, zero backend, zero build step.

**New here?** Click **▶ START DEMO** — a 90-second guided journey (INTENT → LISTEN → SHAPE → HUMAN TWEAK → VERIFY → EXPORT) that shows the whole point in one finished flow.

---

## The idea

Every agentic music tool so far makes the agent *write* — notes, beats, sequences. We asked a different question: **what if the agent could hear?**

Sound design is one of the most human skills in music — you twist knobs until it *feels* right. It's also brutally inaccessible: a synth has ~30 interdependent parameters, and *"make it darker"* doesn't map to any single one. LISTEN proves an agent can close that gap — not by clicking blindly, but by **listening**.

Three things make it different:

1. 👂 **The agent hears.** An `analyze_sound` tool runs real-time FFT on the synth's live output and returns **structured acoustic features** — brightness, bass/mid/high balance, harmonicity, envelope, movement. (Not human-like understanding — measurable features the agent can reason about.) The agent perceives the same output you do.
2. 🔁 **It's genuinely two-way.** Turn a knob by hand and the agent *feels it* — `watch_for_changes` tells it exactly what you moved, and its next `analyze_sound` shows the audible diff. It responds to your intent instead of overwriting it.
3. ✨ **It's for everyone.** Sound design shouldn't require knowing what "resonance" means — or being able to grip 30 tiny knobs. Plain-language controls and natural-language sound goals make it accessible to people who are new to synthesis, and to people who physically can't operate a knob.

## Why this is a strong fit for WebMCP

WebMCP is about agents using **structured tools in the same page you're looking at**, with **shared context** between human and agent. Sound design is that idea made *literal*: you hear the same output the agent analyzes. It also touches the spec's stated goal to **"improve accessibility through agents"** — here, the agent acts as a highly capable intermediary for a task that was previously locked behind motor precision and jargon.

And it uses WebMCP's least-explored feature for real: **save a preset and it dynamically registers as a new agent tool** (`load_preset__midnight_bass`). The agent's vocabulary grows with your sound library.

## What people and agents can do together (that was hard before)

| Before WebMCP | With LISTEN |
|---|---|
| "Make it darker" → guess which of 30 knobs | Agent reads the current spectrum, lowers the filter, **re-listens to confirm it got darker** |
| Agent can't perceive audio at all | `analyze_sound` → `{"brightness":{"centroidHz":195,"label":"dark"}, …}` |
| You tweak something; the agent has no idea | `watch_for_changes` → "you opened the filter — want me to shape around it?" |
| "Sound design" requires synthesis knowledge + fine motor control | "Warm and punchy, please" — or 6 plain-language sliders |
| AI music tools make sounds that vanish when you close the tab | **`render_to_wav` bounces a real audio file + `generate_sound_card` issues a recipe you keep** |

## The full loop (what the software *produces*)

Most agentic music tools make the agent *write* notes. LISTEN makes the agent **design the sound itself, prove it by listening, then hand you production-ready artifacts**:

1. **"Make me a dark techno bass sound"** → agent listens, adjusts, re-listens to verify
2. **"Compose a bassline that fits it"** → `compose_pattern` builds a loop that suits the sound
3. **"Export it for my DAW"** → `export_vital_preset` writes a **production-ready Vital preset** (the free Serum alternative) that loads straight into your project
4. **"Bounce the loop"** → `render_to_wav` renders a **44.1kHz stereo WAV**
5. **"Give me the recipe"** → `generate_sound_card` issues a **Sound DNA card** (PNG/JSON)

Artifacts you actually keep: **a DAW-ready instrument preset, the bounced audio, and a reproducible recipe** — of a sound an agent designed *by ear*, with you.

> **Different from a beat machine:** this isn't a sample sequencer that exports a loop. It's a sound-design partner that exports **the sound itself** — as a preset you can play, plus the audio, plus the recipe.

## The agent loop (try it)

Open the live URL in **ChatGPT's in-app browser** or **Chrome with `chrome://flags/#enable-webmcp-testing`**, then:

1. *"What tools does this synth have?"*
2. *"Play an A and tell me what it sounds like."* → `play_note` + `analyze_sound`
3. *"Make it darker and thicker, but keep the punch."* → `shape_sound`, then re-listens to verify
4. **Turn the cutoff knob yourself** → *"What did I just change?"* → `watch_for_changes`
5. *"Explain this sound in plain words."* → `explain_sound_in_plain_words` (great for everyone)
6. *"Compose a dark techno bassline that fits this sound, then export it as a Vital preset for my DAW."* → `compose_pattern` → `export_vital_preset` 🎛️
7. *"Bounce the loop to a WAV."* → `render_to_wav` 🎵
8. *"Give me the recipe as a card."* → `generate_sound_card` 🧬
9. *"Save this as 'midnight bass'."* → `save_preset` → watch `load_preset__midnight_bass` appear live
10. Later: *"Load midnight bass."* → the agent calls a tool that didn't exist until you created it

No agent handy? The [`@mcp-b/global`](https://www.npmjs.com/package/@mcp-b/global) polyfill exposes `document.modelContext` everywhere — drive it from DevTools:

```js
const tools = await document.modelContext.getTools();
const play = tools.find(t => t.name === "play_note");
await document.modelContext.executeTool(play, { note: "A2", durationMs: 2000 });

const analyze = tools.find(t => t.name === "analyze_sound");
console.log(await document.modelContext.executeTool(analyze, {}));
// → { brightness: { centroidHz: 1215, label: "warm" }, bassMidHigh: {…}, summary: "warm, thick…" }
```

## The tools (19 core + dynamic presets)

**Hearing 👂** — `analyze_sound` (real-time FFT → structured features), `describe_current_sound`
**Shaping 🎛️** — `set_params` (batch), `shape_sound` (natural language), `randomize_patch`
**Playing 🎹** — `play_note`, `play_chord` (names like "C4" / "Cmaj7")
**Two-way 🔁** — `watch_for_changes` (perceive human edits), `compare_to_target` (iterate toward a vibe)
**Composing 🎼** — `compose_pattern` (vibe → loop), `play_pattern`, `stop_pattern`
**Output 📦** — `render_to_wav` (bounce to WAV), `export_vital_preset` (DAW-ready preset), `generate_sound_card` (Sound DNA card)
**Accessibility ✨** — `explain_sound_in_plain_words`
**Presets 💾** — `save_preset`, `list_presets`, plus **dynamic** `load_preset__<name>` for every user preset

### `analyze_sound` — the differentiator

```js
await document.modelContext.registerTool({
  name: "analyze_sound",
  description: "LISTEN to the synth's live output. Real-time FFT + time-domain analysis → structured audio features…",
  inputSchema: { type: "object", properties: {} },
  execute: async () => ({
    content: [{ type: "text", text: JSON.stringify(extractFeatures(liveAnalyserNode)) }],
  }),
});
```

`extractFeatures` computes spectral centroid (brightness), rolloff, bass/mid/high split, estimated fundamental, harmonicity (tonal vs noisy), envelope character (punchy vs smooth), and movement (LFO/envelope activity) — mapped to plain-language labels an agent can reason about. It also diffs against the previous call, so the agent knows **what changed since it last listened — and who changed it.**

## Accessibility, for real

- **Simple mode** — 6 plain-language sliders (Dark ↔ Bright, Thin ↔ Thick, Dry ↔ Spacious…) that move many parameters at once. No synthesis knowledge needed.
- **Plain-words everywhere** — every knob value has an everyday description ("squelchy", "in a big hall", "a slow swell"), exposed to users *and* to the agent.
- **Screen-reader support** — `aria-live` announces every change; full slider/menu roles; keyboard-navigable.
- **`prefers-reduced-motion`** respected; visible focus indicators (WCAG).

## The synth

2 oscillators (saw/square/tri/sine) + sub · lowpass filter (cutoff/resonance/env amount) · ADSR · LFO → cutoff & pitch · delay + generated-impulse reverb · 2-octave keyboard (click + computer keys) · 16-step lookahead sequencer · OfflineAudioContext WAV bounce. All Web Audio API — no samples, no libraries.

## Run it

**Live URL:** _see submission_

**Locally:**
```bash
npx serve .        # or python -m http.server
```

**With an agent:** ChatGPT in-app browser, or Chrome with `chrome://flags/#enable-webmcp-testing`.

## Repo layout

```
index.html      shell + @mcp-b/global polyfill + hearing/output panels
styles.css      dark studio theme + hyperrealistic machine styling
js/audio.js     Web Audio engine + analyzeSound() (the agent's ear) + plain-words
js/presets.js   built-in + user presets
js/composer.js  lookahead sequencer + agent composition (vibe → pattern)
js/bounce.js    OfflineAudioContext render + WAV encoder (44.1kHz stereo)
js/dnacard.js   'Sound DNA' card renderer (canvas → PNG/JSON)
js/vital.js     production-ready Vital (.vital) preset exporter
js/ui.js        knobs, keyboard, visualizers, sequencer grid, takes, a11y
js/tools.js     WebMCP layer: 20 core tools + dynamic preset tools
js/devconsole.js  built-in Agent Console (test tools without an external agent)
js/activity.js  live tool list + activity feed
js/main.js      bootstrap
netlify.toml    sets Origin-Agent-Cluster: ?1 (WebMCP origin isolation)
```

## License

MIT — see [LICENSE](LICENSE).
