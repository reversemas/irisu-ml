import assert from "node:assert/strict";
import test from "node:test";
import {createSoundtrack, pickNext} from "../static/music.mjs";

const tracks = ["./music/a.mp3", "./music/b.mp3", "./music/c.mp3"];
const running = (seed = 1, extra = {}) => ({seed, mode: "play", running: true, observation: {terminated: false}, ...extra});

function fakeAudio() {
  const listeners = {};
  return {
    src: "", paused: true, plays: 0, pauses: 0,
    addEventListener(name, callback) { listeners[name] = callback; },
    emit(name) { listeners[name]?.(); },
    play() { this.paused = false; this.plays++; return Promise.resolve(); },
    pause() { this.paused = true; this.pauses++; },
  };
}

async function setup(random = () => 0, list = tracks) {
  const audio = fakeAudio();
  const music = createSoundtrack({}, {location: {protocol: "capacitor:"}}, {
    random, createAudio: () => audio, loadTracks: async () => ({version: "v", tracks: list}), cache: async () => {},
  });
  await music.ready;
  return {audio, music};
}

test("pickNext never repeats the previous track when there is a choice", () => {
  for (let i = 0; i < 20; i++) assert.notEqual(pickNext(tracks, "./music/b.mp3", () => i / 20), "./music/b.mp3");
  assert.equal(pickNext(["only.mp3"], "only.mp3"), "only.mp3");
  assert.equal(pickNext([], null), null);
  assert.equal(pickNext(tracks, null, () => 0.999999), "./music/c.mp3");
});

test("music waits for a user gesture, then plays a random track", async () => {
  const {audio, music} = await setup(() => 0.5);
  music.update(running());
  assert.equal(audio.plays, 0);
  music.start();
  assert.equal(audio.src, "./music/b.mp3");
  assert.equal(audio.plays, 1);
});

test("when a track ends another random track starts, never the same one", async () => {
  const {audio, music} = await setup(() => 0);
  music.update(running());
  music.start();
  const first = audio.src;
  audio.paused = true;
  audio.emit("ended");
  assert.notEqual(audio.src, first);
  assert.equal(audio.plays, 2);
});

test("pausing or ending the game pauses the music, resuming continues the same track", async () => {
  const {audio, music} = await setup(() => 0);
  music.start();
  music.update(running());
  const track = audio.src;
  music.update(running(1, {running: false}));
  assert.equal(audio.paused, true);
  music.update(running());
  assert.equal(audio.src, track);
  assert.equal(audio.paused, false);
  music.update(running(1, {observation: {terminated: true}}));
  assert.equal(audio.paused, true);
});

test("a new run picks a fresh random track", async () => {
  const {audio, music} = await setup(() => 0);
  music.start();
  music.update(running(1));
  const first = audio.src;
  music.update(running(2));
  assert.notEqual(audio.src, first);
  assert.equal(audio.paused, false);
});

test("an unreadable track is skipped, and it stops after every track failed", async () => {
  const {audio, music} = await setup(() => 0, ["./music/x.mp3", "./music/y.mp3"]);
  music.start();
  music.update(running());
  for (let i = 0; i < 6; i++) audio.emit("error");
  assert.ok(audio.plays <= 3);
});

test("no tracks means silence without errors", async () => {
  const {audio, music} = await setup(() => 0, []);
  music.start();
  music.update(running());
  assert.equal(audio.plays, 0);
});
