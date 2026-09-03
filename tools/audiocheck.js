/* Execute every Sound method against a fake WebAudio graph.
 * The sim harness stubs Sound, so a typo inside audio.js would never run there
 * — this is the cheap way to prove the audio paths actually work, with no
 * browser and no sound card. */
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = process.argv[2];
const calls = { node: 0, connect: 0, start: 0 };
const mkNode = (extra = {}) => Object.assign({
  connect: () => { calls.connect++; },
  disconnect() {},
  start: () => { calls.start++; },
  stop() {},
  gain: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} },
  frequency: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} },
  Q: { value: 1 },
  type: '', buffer: null, playbackRate: { value: 1 }, curve: null, oversample: '',
  detune: { value: 0 }, pan: { value: 0 }, threshold: { value: 0 }, knee: { value: 0 },
  ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 }, normalize: true,
}, extra);
const ctx = {
  currentTime: 0, sampleRate: 48000, destination: mkNode(),
  createGain: () => (calls.node++, mkNode()),
  createOscillator: () => (calls.node++, mkNode()),
  createBufferSource: () => (calls.node++, mkNode()),
  createBiquadFilter: () => (calls.node++, mkNode()),
  createStereoPanner: () => (calls.node++, mkNode()),
  createConvolver: () => (calls.node++, mkNode()),
  createWaveShaper: () => (calls.node++, mkNode()),
  createDynamicsCompressor: () => (calls.node++, mkNode()),
  createBuffer: (ch, len, sr) => ({ length: len, numberOfChannels: ch, sampleRate: sr,
    getChannelData: () => new Float32Array(len) }),
  decodeAudioData: () => Promise.resolve(null),
};
const sandbox = { console, Math, Date, window: {},
  setInterval: () => 0, clearInterval: () => {}, fetch: () => Promise.reject(new Error('no net')),
  AudioContext: function () { return ctx; }, webkitAudioContext: function () { return ctx; },
  requestAnimationFrame: () => 0 };
sandbox.globalThis = sandbox;
const src = ['js/data.js', 'js/audio.js']
  .map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n;\n');
vm.createContext(sandbox);
vm.runInContext(src + '\n;globalThis.__S = Sound;', sandbox, { filename: 'audio.js' });
const S = sandbox.__S;
S.ctx = ctx; S.muted = false;
S._loadSamples = () => {};        // no network
S._samp = {};                     // force the synth path, which is what is new
const results = {};
const call = (name, fn) => {
  const before = calls.node;
  try { fn(); results[name] = 'ok (+' + (calls.node - before) + ' nodes)'; }
  catch (e) { results[name] = 'THREW: ' + e.message; }
};
try { S.init(); } catch (e) { /* init may want more of the DOM; the methods matter */ }
S.ctx = ctx;
for (const v of Object.keys(S.VOICES)) call('shot:' + v, () => S.shot(v, 600));
call('blooper', () => S.blooper(600));
for (const k of ['dirt', 'wood', 'metal', 'water']) call('impact:' + k, () => S.impact(k, 600));
call('manDown', () => S.manDown(600));
call('ricochet', () => S.ricochet(600));
call('explosion', () => S.explosion(1, 600));
call('sniperShot', () => S.sniperShot(600));
call('shovel', () => S.shovel(600));
call('reload', () => S.reload(600));
call('belt', () => S.belt(600));
/* The music is SCHEDULED rather than fired, so nothing else would ever execute
   it. Start it, drive a few bars by hand at both ends of the tension range —
   the layers are gated on tension, so a quiet-only run would leave the pulse
   and air branches unvisited — then stop it. */
call('musicStart', () => S.musicStart('iadrang'));
for (const t of [0, 0.3, 0.7, 1]) {
  call('musicBar@' + t, () => {
    S.musicTension(t);
    if (S._mus) { S._mus.next = ctx.currentTime; ctx.currentTime += 4; S._musTick(); }
  });
}
call('musicStop', () => S.musicStop());
const bad = Object.entries(results).filter(([, v]) => v.startsWith('THREW'));
console.log(JSON.stringify({ checked: Object.keys(results).length,
  failures: bad.length, detail: bad.length ? Object.fromEntries(bad) : results }, null, 1));
process.exit(bad.length ? 1 : 0);
