// grow: 秒；yield: 每块地基础产量；price: 每个果实售价
export const CROPS = [
  { id: 'carrot',     name: '胡萝卜', lv: 1,  seed: 8,   grow: 30,  yield: 5, price: 3,   xp: 4,   seasons: 1, layout: 3, color: '#ff8a2a' },
  { id: 'wheat',      name: '小麦',   lv: 1,  seed: 12,  grow: 60,  yield: 7, price: 3,   xp: 6,   seasons: 1, layout: 3, color: '#f1c75b' },
  { id: 'corn',       name: '玉米',   lv: 2,  seed: 20,  grow: 90,  yield: 5, price: 7,   xp: 10,  seasons: 1, layout: 2, color: '#ffd54f' },
  { id: 'tomato',     name: '番茄',   lv: 3,  seed: 30,  grow: 120, yield: 6, price: 8,   xp: 14,  seasons: 2, layout: 2, color: '#ef4b3c' },
  { id: 'eggplant',   name: '茄子',   lv: 4,  seed: 40,  grow: 150, yield: 6, price: 10,  xp: 18,  seasons: 2, layout: 2, color: '#8e44ad' },
  { id: 'strawberry', name: '草莓',   lv: 5,  seed: 55,  grow: 180, yield: 9, price: 9,   xp: 24,  seasons: 2, layout: 3, color: '#ff4f6d' },
  { id: 'sunflower',  name: '向日葵', lv: 6,  seed: 70,  grow: 240, yield: 4, price: 35,  xp: 32,  seasons: 1, layout: 2, color: '#ffc928' },
  { id: 'pumpkin',    name: '南瓜',   lv: 8,  seed: 100, grow: 300, yield: 3, price: 70,  xp: 45,  seasons: 1, layout: 2, color: '#ff9417' },
  { id: 'watermelon', name: '西瓜',   lv: 10, seed: 150, grow: 420, yield: 3, price: 100, xp: 65,  seasons: 1, layout: 2, color: '#43a047' },
  { id: 'starfruit',  name: '星光果', lv: 12, seed: 260, grow: 600, yield: 3, price: 160, xp: 100, seasons: 2, layout: 1, color: '#ffe066' },
];
export const CROP = Object.fromEntries(CROPS.map((c) => [c.id, c]));

export const STAGE_NAMES = ['种子期', '发芽期', '幼苗期', '成长期', '成熟期'];
// 生长进度阈值：达到即进入对应阶段
export const STAGE_AT = [0, 0.12, 0.35, 0.65, 1];

export const levelNeed = (lv) => Math.round(40 + 45 * (lv - 1) + 12 * (lv - 1) ** 2);

export const GRID = 4;
export const PLOT_COUNT = GRID * GRID;
// 离镜头最近的地块先开放
export const UNLOCK_ORDER = [15, 14, 11, 13, 10, 7, 12, 9, 6, 3, 8, 5, 2, 4, 1, 0];
export const UNLOCK_REQ = [
  null, null, null, null, null, null,
  { lv: 2, coins: 300 }, { lv: 3, coins: 500 }, { lv: 4, coins: 800 }, { lv: 5, coins: 1200 },
  { lv: 6, coins: 1800 }, { lv: 7, coins: 2500 }, { lv: 8, coins: 3500 }, { lv: 9, coins: 4800 },
  { lv: 10, coins: 6500 }, { lv: 12, coins: 9000 },
];

export const ITEMS = {
  fert: { id: 'fert', name: '化肥', desc: '作物立刻长到下一个阶段', price: 30, currency: 'coins' },
  superFert: { id: 'superFert', name: '神奇化肥', desc: '作物瞬间成熟', price: 3, currency: 'gems' },
};

export const NEIGHBORS = [
  { id: 'mei',     name: '小美',   lv: 8,  avatar: '🐰', color: '#ff7eb6', dog: true,  dogName: '豆豆' },
  { id: 'qiang',   name: '阿强',   lv: 12, avatar: '🐯', color: '#ffa53d', dog: true,  dogName: '大黄' },
  { id: 'wang',    name: '王大爷', lv: 20, avatar: '👴', color: '#8d6e63', dog: true,  dogName: '小黑' },
  { id: 'luna',    name: 'Luna',   lv: 6,  avatar: '🦊', color: '#a77bff', dog: false },
  { id: 'penguin', name: '企鹅君', lv: 15, avatar: '🐧', color: '#4fc3f7', dog: true,  dogName: '雪球' },
  { id: 'hu',      name: '胖虎',   lv: 10, avatar: '🐻', color: '#66bb6a', dog: false },
];

export const WHEEL = [
  { type: 'coins', n: 50,  label: '50', sub: '金币', color: '#ffcf3f', weight: 22 },
  { type: 'fert',  n: 2,   label: '×2', sub: '化肥', color: '#7ed957', weight: 18 },
  { type: 'coins', n: 150, label: '150', sub: '金币', color: '#4fb3ff', weight: 16 },
  { type: 'gems',  n: 3,   label: '×3', sub: '钻石', color: '#ff8a5c', weight: 12 },
  { type: 'seeds', n: 3,   label: '?', sub: '神秘种子', color: '#c07cff', weight: 14 },
  { type: 'xp',    n: 60,  label: '60', sub: '经验', color: '#5ee0c8', weight: 12 },
  { type: 'coins', n: 666, label: '666', sub: '大奖', color: '#ff5a6e', weight: 3 },
  { type: 'gems',  n: 10,  label: '×10', sub: '钻石', color: '#ffe066', weight: 3 },
];
export const WHEEL_COOLDOWN = 8 * 60 * 1000;
export const WHEEL_GEM_COST = 5;

export const QUEST_POOL = [
  { k: 'plant',   name: '勤劳播种', desc: (n) => `播种 ${n} 次`,               base: 6,   step: 4,   reward: { coins: 80 } },
  { k: 'harvest', name: '丰收时刻', desc: (n) => `收获 ${n} 块地`,             base: 5,   step: 3,   reward: { gems: 2 } },
  { k: 'steal',   name: '月黑风高', desc: (n) => `去好友家偷菜 ${n} 次`,       base: 3,   step: 2,   reward: { fert: 2 } },
  { k: 'help',    name: '热心邻居', desc: (n) => `帮好友除草/除虫/浇水 ${n} 次`, base: 3,   step: 2,   reward: { xp: 40 } },
  { k: 'care',    name: '悉心照料', desc: (n) => `给自家作物除草/除虫/浇水 ${n} 次`, base: 4, step: 3, reward: { coins: 60 } },
  { k: 'sell',    name: '生意兴隆', desc: (n) => `卖果实赚 ${n} 金币`,         base: 120, step: 120, reward: { gems: 1, coins: 50 } },
];

export const TOOLS = [
  { id: 'hand',  name: '收获', key: '1', icon: 'basket' },
  { id: 'seed',  name: '播种', key: '2', icon: 'sprout' },
  { id: 'water', name: '浇水', key: '3', icon: 'can' },
  { id: 'weed',  name: '除草', key: '4', icon: 'sickle' },
  { id: 'bug',   name: '杀虫', key: '5', icon: 'spray' },
  { id: 'fert',  name: '施肥', key: '6', icon: 'fert' },
  { id: 'shovel', name: '铲除', key: '7', icon: 'shovel' },
];
export const VISIT_TOOLS = ['hand', 'water', 'weed', 'bug'];

export const DAY_LENGTH = 6 * 60 * 1000;
