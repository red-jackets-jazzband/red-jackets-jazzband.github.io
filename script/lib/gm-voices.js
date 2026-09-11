// A curated General MIDI instrument subset for the Mixer's per-channel Voice
// picker — not the full 128-entry GM set, just what suits a jazz combo (same
// spirit as lib/instruments.js's playing-instrument list, but this picks the
// *sound* SynthController renders, not which transposed part is on the
// page). `value` is the 0-indexed GM program number that ABCjs's
// %%MIDI program / bassprog / chordprog directives all expect.
export const GM_VOICES = [
  { value: 0, label: "Piano", group: "Keys" },
  { value: 4, label: "Electric Piano", group: "Keys" },
  { value: 16, label: "Organ", group: "Keys" },
  { value: 11, label: "Vibraphone", group: "Keys" },
  { value: 24, label: "Acoustic Guitar (nylon)", group: "Guitars" },
  { value: 25, label: "Acoustic Guitar (steel)", group: "Guitars" },
  { value: 26, label: "Jazz Guitar", group: "Guitars" },
  { value: 105, label: "Banjo", group: "Guitars" },
  { value: 32, label: "Acoustic Bass", group: "Bass" },
  { value: 33, label: "Electric Bass (finger)", group: "Bass" },
  { value: 34, label: "Electric Bass (pick)", group: "Bass" },
  { value: 43, label: "Contrabass", group: "Bass" },
  { value: 56, label: "Trumpet", group: "Brass" },
  { value: 59, label: "Muted Trumpet", group: "Brass" },
  { value: 57, label: "Trombone", group: "Brass" },
  { value: 58, label: "Tuba", group: "Brass" },
  { value: 60, label: "French Horn", group: "Brass" },
  { value: 61, label: "Brass Section", group: "Brass" },
  { value: 65, label: "Alto Sax", group: "Reeds" },
  { value: 66, label: "Tenor Sax", group: "Reeds" },
  { value: 67, label: "Baritone Sax", group: "Reeds" },
  { value: 71, label: "Clarinet", group: "Reeds" },
  { value: 73, label: "Flute", group: "Reeds" },
];
