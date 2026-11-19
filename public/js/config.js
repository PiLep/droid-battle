// Constantes de gameplay. Les valeurs SCORING doivent rester cohérentes avec server/scoring.js.

export const ARENA = { w: 1600, h: 900 };

export const COLORS = {
  bg: '#04050c',
  p1: '#2de2ff',
  p2: '#ff3fd8',
  player: '#2de2ff',
  enemy: '#ff4d5e',
  hp: '#3dff9a',
  energy: '#ffd23d',
  white: '#ffffff',
};

// Classes de droïdes jouables
export const DROIDS = {
  striker: {
    id: 'striker',
    name: 'STRIKER',
    role: 'Polyvalent',
    hp: 200,
    speed: 280,
    accel: 11,
    radius: 22,
    dashCd: 0.8,
    stats: { power: 3, speed: 3, armor: 3 },
    weapon: {
      name: 'Blaster plasma',
      interval: 0.13,
      speed: 950,
      damage: 9.5,
      spread: 0.035,
      count: 1,
      radius: 5,
      knock: 110,
      life: 1.1,
      recoil: 3,
      sound: 'blaster',
    },
    special: { id: 'nova', name: 'NOVA', desc: 'Onde de choc qui repousse tout et pulvérise les tirs ennemis.' },
  },
  titan: {
    id: 'titan',
    name: 'TITAN',
    role: 'Blindé',
    hp: 270,
    speed: 220,
    accel: 8,
    radius: 27,
    dashCd: 1.1,
    stats: { power: 5, speed: 2, armor: 5 },
    weapon: {
      name: 'Canon à fragmentation',
      interval: 0.6,
      speed: 800,
      damage: 7,
      spread: 0.36,
      count: 7,
      radius: 4.5,
      knock: 120,
      life: 0.6,
      falloff: 0.5, // perd jusqu'à 50 % de dégâts en fin de portée
      recoil: 9,
      sound: 'scatter',
    },
    special: { id: 'salvo', name: 'SALVE', desc: 'Huit missiles à tête chercheuse qui explosent au contact.' },
  },
  viper: {
    id: 'viper',
    name: 'VIPER',
    role: 'Rapide',
    hp: 170,
    speed: 345,
    accel: 15,
    radius: 19,
    dashCd: 0.55,
    stats: { power: 2, speed: 5, armor: 2 },
    weapon: {
      name: 'Mitrailleuses jumelles',
      interval: 0.068,
      speed: 1180,
      damage: 4.4,
      spread: 0.06,
      count: 1,
      twin: true,
      radius: 3.6,
      knock: 25,
      life: 0.95,
      recoil: 1.5,
      sound: 'smg',
    },
    special: { id: 'rail', name: 'RAIL', desc: 'Rayon perforant chargé qui traverse tous les ennemis alignés.' },
  },
};

export const DROID_ORDER = ['striker', 'titan', 'viper'];

export const DASH = { duration: 0.17, speed: 980, buffer: 0.15 };

export const SPECIAL = {
  max: 100,
  passive: 2.5, // par seconde
  perDamageDealt: 0.42,
  perDamageTaken: 0.3,
  nova: { radius: 300, damage: 70, knock: 900, speed: 1100 },
  salvo: { count: 8, damage: 13, radius: 60, speed: 560, turn: 4.2, interval: 0.06 },
  rail: { charge: 0.38, damage: 95, width: 22 },
};

// Ennemis du mode arcade
export const ENEMIES = {
  scarab: { name: 'Scarab', hp: 22, speed: 235, radius: 14, color: '#ff4d5e', points: 100, contactDamage: 20, mass: 0.6 },
  gunner: { name: 'Gunner', hp: 46, speed: 145, radius: 18, color: '#ff8a3d', points: 200, damage: 10, mass: 1 },
  lancer: { name: 'Lancer', hp: 38, speed: 120, radius: 17, color: '#b45cff', points: 300, damage: 28, mass: 0.9 },
  brute: { name: 'Brute', hp: 190, speed: 90, radius: 30, color: '#ff3b3b', points: 500, damage: 12, mass: 3 },
  boss: { name: 'OVERLORD', hp: 1500, speed: 70, radius: 62, color: '#ff2e6a', points: 5000, damage: 11, mass: 20 },
};

export const SCORING = {
  comboWindow: 3.2,
  multiplierSteps: [0, 5, 12, 20, 30, 45, 60, 80], // combo requis pour x1..x8
  waveBonus: 250,
  perfectBonus: 100,
};

export const DUEL = { roundsToWin: 2, roundTime: 90, pickupEvery: 9 };

export const PICKUPS = {
  repair: { color: '#3dff9a', amount: 45, label: '+PV' },
  energy: { color: '#ffd23d', amount: 45, label: '+ÉNERGIE' },
};
