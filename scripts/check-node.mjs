// Runs before `npm start` (the "prestart" script): a Node.js that is too old fails later with an unhelpful
// "bad option: --experimental-strip-types", so say what is needed instead. Plain JS that any Node version can parse.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 7)) {
  console.error(`Waggle needs Node.js 22.7 or newer (it runs the TypeScript sources directly); this is Node.js ${process.versions.node}.`);
  console.error('Install a current Node.js from https://nodejs.org/ (or use nvm / fnm), then run npm start again.');
  process.exit(1);
}
