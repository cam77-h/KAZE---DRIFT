// In-game credits (Settings → Credits). Keep in sync with CREDITS.md.
export interface Credit {
  title: string;
  author: string;
  license: 'CC-BY 4.0' | 'CC0' | 'MIT' | 'OFL 1.1';
  url: string;
  use: string;
}

export const CREDITS: Credit[] = [
  { title: 'Toyota AE86', author: 'IvOfficial', license: 'CC-BY 4.0', url: 'https://poly.pizza/m/ZEFWmOPSgh', use: 'Takumi AE' },
  { title: 'Mazda RX-7', author: 'IvOfficial', license: 'CC-BY 4.0', url: 'https://poly.pizza/m/SnIoWlh7S2', use: "Kaze R7 '87" },
  { title: 'Nissan GTR', author: 'David Sirera', license: 'CC-BY 4.0', url: 'https://poly.pizza/m/a_HKCtYAv2W', use: 'Raiden 34' },
  { title: '1994 Nissan 180MX', author: 'Grzybek', license: 'CC-BY 4.0', url: 'https://poly.pizza/m/c7vlPQ8dlt', use: 'Sakura 18 Targa' },
  { title: 'Sports Car', author: 'Quaternius', license: 'CC0', url: 'https://poly.pizza/m/Gzj704DXdr', use: 'Hoshi GT' },
  { title: 'Sports Car', author: 'Quaternius', license: 'CC0', url: 'https://poly.pizza/m/OyqKvX9xNh', use: 'Kumo Sedan' },
  { title: 'Sports Car', author: 'Quaternius', license: 'CC0', url: 'https://poly.pizza/m/1mkmFkAz5v', use: 'Sento RS' },
  { title: 'Taxi', author: 'Quaternius', license: 'CC0', url: 'https://poly.pizza/m/x43lOScTpN', use: 'Traffic' },
  { title: 'Car Hatchback', author: 'Kay Lousberg', license: 'CC0', url: 'https://poly.pizza/m/BG0KAhmGDt', use: 'Traffic' },
  { title: '80s Car', author: 'Nick Ladd', license: 'CC-BY 4.0', url: 'https://poly.pizza/m/7tPSW5UYD20', use: 'Show car at meets' },
  { title: 'Mini Car !', author: 'Romain Revert', license: 'CC-BY 4.0', url: 'https://poly.pizza/m/eNH2gURnsVB', use: 'Easter egg' },
  { title: 'Red Car', author: 'J-Toastie', license: 'CC-BY 4.0', url: 'https://poly.pizza/m/dVLJ5CjB0h', use: 'Traffic' },
  { title: 'Sports Hatchback', author: 'ReppenThe303', license: 'CC-BY 4.0', url: 'https://poly.pizza/m/DobtD8JyoW', use: 'Parked cars' },
  { title: 'Car Kit', author: 'Kenney (www.kenney.nl)', license: 'CC0', url: 'https://kenney.nl/assets/car-kit', use: 'Traffic, wheels, cones, debris' },
  { title: 'three.js', author: 'three.js authors', license: 'MIT', url: 'https://threejs.org', use: 'Rendering' },
  { title: 'Chakra Petch', author: 'Cadson Demak', license: 'OFL 1.1', url: 'https://fonts.google.com/specimen/Chakra+Petch', use: 'UI type' },
  { title: 'Zen Kaku Gothic New', author: 'Yoshimichi Ohira', license: 'OFL 1.1', url: 'https://fonts.google.com/specimen/Zen+Kaku+Gothic+New', use: 'Japanese type' },
];
