/** 名字以这些称谓结尾时（陈工、刘厂长），原型的头像取姓 */
const TITLES = ['厂长', '工'];

/**
 * 头像里的字（原型 data.py 的 STAFF.avatar）：一般取名字的最后一个字（李婷 → 婷），
 * 以称谓结尾的取第一个字（陈工 → 陈）。
 */
export function avatarText(name: string): string {
  const chars = [...name.trim()];
  const titled = TITLES.some((t) => name.endsWith(t) && chars.length > t.length);
  return (titled ? chars[0] : chars.at(-1)) ?? '';
}
