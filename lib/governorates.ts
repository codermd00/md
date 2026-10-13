export const GOVERNORATES = [
  "بغداد", "البصرة", "نينوى", "أربيل", "السليمانية", "دهوك", "كركوك", "الأنبار", "ديالى", "صلاح الدين",
  "بابل", "كربلاء", "النجف", "واسط", "ذي قار", "ميسان", "المثنى", "القادسية",
] as const;
export const UNKNOWN_GOV = "غير محدد";

// اسم المنطقة كما ترجعه Meta (EN) → المحافظة العربية
const META: [string, string][] = [
  ["baghdad", "بغداد"], ["basra", "البصرة"], ["basrah", "البصرة"], ["nineveh", "نينوى"], ["ninawa", "نينوى"], ["erbil", "أربيل"], ["arbil", "أربيل"],
  ["sulaymaniyah", "السليمانية"], ["sulaimaniyah", "السليمانية"], ["duhok", "دهوك"], ["dohuk", "دهوك"], ["kirkuk", "كركوك"], ["anbar", "الأنبار"],
  ["diyala", "ديالى"], ["salah", "صلاح الدين"], ["saladin", "صلاح الدين"], ["babil", "بابل"], ["babylon", "بابل"], ["karbala", "كربلاء"],
  ["najaf", "النجف"], ["wasit", "واسط"], ["dhi qar", "ذي قار"], ["thi qar", "ذي قار"], ["maysan", "ميسان"], ["missan", "ميسان"],
  ["muthanna", "المثنى"], ["qadisiyyah", "القادسية"], ["qadisiyah", "القادسية"], ["diwaniyah", "القادسية"],
];
export function metaRegionToGov(region: string): string | null {
  const r = region.toLowerCase();
  return META.find(([k]) => r.includes(k))?.[1] ?? null;
}
