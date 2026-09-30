const ADJECTIVES = [
  "Swift", "Lucky", "Clever", "Brave", "Sneaky", "Mighty", "Cosmic", "Turbo",
  "Golden", "Wild", "Zesty", "Rapid",
];

const ANIMALS = [
  "Fox", "Panda", "Otter", "Hawk", "Tiger", "Wolf", "Koala", "Falcon",
  "Lynx", "Dolphin", "Raven", "Gecko",
];

export function randomName(): string {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const b = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return `${a} ${b}`;
}
