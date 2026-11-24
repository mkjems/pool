// Fun nicknames for friend matches: an adjective and something from the pool hall. Looks only, so Math.random is fine.

const first = [
  "Lucky", "Sneaky", "Smooth", "Wobbly", "Cosmic", "Sleepy", "Mighty", "Grumpy", "Dizzy", "Velvet",
  "Turbo", "Humble", "Fancy", "Rusty", "Jolly", "Crafty", "Chalky", "Breezy", "Spicy", "Captain",
  "Silent", "Golden", "Wild", "Lazy", "Sir", "Doctor", "Tiny", "Noble",
];
const second = [
  "Cue", "Pocket", "Banker", "Breaker", "Hustler", "Shark", "Spinner", "Chalker", "Rail Rider", "Kiss Shot",
  "Eight Ball", "Corner", "Bridge", "Jumper", "Screw Back", "Cannon", "Double", "Stun", "Side Spin", "Cushion",
  "Rack", "Scratch", "Long Pot", "Safety",
];

const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

/** A new nickname, at most `max` characters and not the same as `not`. */
export function funNick(max = 20, not = ""): string {
  for (;;) {
    const n = `${pick(first)} ${pick(second)}`;
    if (n.length <= max && n !== not) return n;
  }
}
