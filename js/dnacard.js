/* dnacard.js — the "Sound DNA" card: a shareable artifact that captures what
   the agent HEARD. Renders name, the agent's own words, waveform, spectrum,
   and the patch recipe to a canvas → downloadable PNG/JSON. */
(function () {
  function generate(opts = {}) {
    const analysis = opts.analysis || Synth.analyzeSound._last || null;
    const patch = JSON.parse(JSON.stringify(Synth.patch, (k, v) => (k.startsWith("_") ? undefined : v)));
    const name = opts.name || "untitled_sound";
    const vibe = opts.vibe || (analysis ? analysis.summary : "");

    const W = 880, H = 520;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const c = canvas.getContext("2d");

    // background
    const bg = c.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, "#171b26"); bg.addColorStop(1, "#0d1017");
    c.fillStyle = bg; c.fillRect(0, 0, W, H);
    // subtle grid
    c.strokeStyle = "rgba(255,255,255,0.03)"; c.lineWidth = 1;
    for (let x = 0; x < W; x += 22) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
    for (let y = 0; y < H; y += 22) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }

    const accent = "#4f6bff", pink = "#ec4899", dim = "#8b96ad", faint = "#5a6478";

    // header
    c.fillStyle = "#e8ecf4";
    c.font = "800 34px 'Segoe UI', sans-serif";
    c.fillText("🎧 LISTEN", 36, 56);
    c.fillStyle = dim; c.font = "600 13px 'Cascadia Code', monospace";
    c.fillText("SOUND DNA · rendered by an agent that can hear", 36, 80);

    // name
    c.fillStyle = pink; c.font = "800 44px 'Segoe UI', sans-serif";
    c.fillText(name.replace(/_/g, " ").toUpperCase(), 36, 138);

    // agent's words (vibe)
    c.fillStyle = "#c6d0e6"; c.font = "italic 20px 'Segoe UI', sans-serif";
    c.fillText(`“${vibe}”`, 36, 176);

    // analysis stats chips
    const stats = analysis ? [
      ["BRIGHTNESS", analysis.brightness.label, `${analysis.brightness.centroidHz}Hz`],
      ["BODY", analysis.bassMidHigh.label, `L${Math.round(analysis.bassMidHigh.low * 100)} M${Math.round(analysis.bassMidHigh.mid * 100)} H${Math.round(analysis.bassMidHigh.high * 100)}`],
      ["TONE", analysis.harmonicity.label, analysis.harmonicity.value],
      ["ENVELOPE", analysis.envelope.label, ""],
      ["MOTION", analysis.movement.label, analysis.movement.value],
    ] : [];
    let sx = 36;
    stats.forEach(([label, big, small]) => {
      const w = 150;
      c.fillStyle = "rgba(255,255,255,0.05)";
      roundRect(c, sx, 200, w - 10, 62, 8); c.fill();
      c.fillStyle = faint; c.font = "700 9px 'Segoe UI', sans-serif";
      c.fillText(label, sx + 10, 220);
      c.fillStyle = "#e8ecf4"; c.font = "700 18px 'Segoe UI', sans-serif";
      c.fillText(String(big), sx + 10, 242);
      c.fillStyle = accent; c.font = "10px 'Cascadia Code', monospace";
      c.fillText(String(small), sx + 10, 256);
      sx += w;
    });

    // waveform + spectrum panels
    drawWaveform(c, 36, 288, 400, 130, accent);
    drawSpectrum(c, 452, 288, 392, 130, pink);

    // recipe (patch) footer
    c.fillStyle = faint; c.font = "700 10px 'Segoe UI', sans-serif";
    c.fillText("PATCH RECIPE", 36, 452);
    c.fillStyle = "#aeb8d0"; c.font = "11px 'Cascadia Code', monospace";
    const recipe = [
      `oscA ${patch.oscA.wave} oct${patch.oscA.octave} det${patch.oscA.detune}¢ lvl${patch.oscA.level}`,
      `oscB ${patch.oscB.wave} oct${patch.oscB.octave} det${patch.oscB.detune}¢ lvl${patch.oscB.level}`,
      `sub ${patch.sub.level} · lp ${Math.round(patch.filter.cutoff)}Hz Q${patch.filter.resonance.toFixed(1)} env${Math.round(patch.filter.envAmount)}`,
      `adsr ${patch.env.attack}s/${patch.env.decay}s/${patch.env.sustain}/${patch.env.release}s · lfo ${patch.lfo.wave} ${patch.lfo.rate}Hz →cut${Math.round(patch.lfo.toCutoff)}`,
      `fx dly${patch.fx.delayTime}s/${patch.fx.delayMix} rev${patch.fx.reverbMix}`,
    ];
    recipe.forEach((line, i) => c.fillText(line, 36, 472 + i * 15));

    // timestamp
    c.fillStyle = faint; c.font = "10px 'Cascadia Code', monospace";
    const ts = new Date().toISOString().replace("T", " ").slice(0, 16);
    c.fillText(ts, W - 160, H - 18);

    return {
      canvas,
      toPngBlob: () => new Promise((res) => canvas.toBlob(res, "image/png")),
      recipeJson: { name, vibe, analysis, patch, renderedAt: new Date().toISOString() },
    };
  }

  function drawWaveform(c, x, y, w, h, color) {
    c.fillStyle = "rgba(0,0,0,0.3)"; roundRect(c, x, y, w, h, 8); c.fill();
    c.fillStyle = "#5a6478"; c.font = "700 9px 'Segoe UI', sans-serif";
    c.fillText("WAVEFORM", x + 10, y + 16);
    const { analyser } = Synth.getAnalysers();
    c.strokeStyle = color; c.lineWidth = 2; c.beginPath();
    if (analyser) {
      const td = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(td);
      const step = Math.floor(td.length / w);
      for (let i = 0; i < w; i++) {
        const v = td[i * step] / 255;
        const yy = y + h / 2 + (v - 0.5) * (h - 30);
        i === 0 ? c.moveTo(x + 4, yy) : c.lineTo(x + 4 + i, yy);
      }
    } else {
      c.moveTo(x + 4, y + h / 2); c.lineTo(x + w - 4, y + h / 2);
    }
    c.stroke();
  }

  function drawSpectrum(c, x, y, w, h, color) {
    c.fillStyle = "rgba(0,0,0,0.3)"; roundRect(c, x, y, w, h, 8); c.fill();
    c.fillStyle = "#5a6478"; c.font = "700 9px 'Segoe UI', sans-serif";
    c.fillText("SPECTRUM", x + 10, y + 16);
    const { analyser } = Synth.getAnalysers();
    if (!analyser) return;
    const fb = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(fb);
    const bars = 48, step = Math.floor(fb.length * 0.6 / bars), bw = (w - 16) / bars;
    for (let i = 0; i < bars; i++) {
      const v = fb[i * step] / 255;
      const bh = v * (h - 34);
      const grad = c.createLinearGradient(0, y + h - 8, 0, y + 24);
      grad.addColorStop(0, "#4f6bff"); grad.addColorStop(1, color);
      c.fillStyle = grad;
      c.fillRect(x + 8 + i * bw, y + h - 8 - bh, bw - 1, bh);
    }
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  window.DnaCard = { generate };
})();
