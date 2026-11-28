const portraitNames = new Map([
  ['homelander', 'Homelander'],
  ['trump2', 'Donald Trump'],
  ['trump3', 'Donald Trump'],
  ['Tokugawa 06 face AI v2', 'Tokugawa'],
  ['Taka (ONE OK ROCK)', 'Taka'],
  ['yajuu 01', 'Yajuu'],
]);

export function characterName(label) {
  if (portraitNames.has(label)) return portraitNames.get(label);
  if (/^Unknown \(Male \d+\)$/i.test(label)) return 'Unknown';
  return label.replace(/(?:\s+(?:\d+|v\d+|nobald|bald))+$/i, '');
}
