import { getDemoFixture } from '@forcome/fixtures';
import { describe, expect, it } from 'vitest';
import { avatarText } from './avatar';

describe('头像里的字', () => {
  it('与原型示例数据里每位成员的头像字一致', () => {
    for (const member of getDemoFixture().members) {
      expect({ name: member.name, avatar: avatarText(member.name) }).toEqual({
        name: member.name,
        avatar: member.avatar,
      });
    }
  });

  it('称谓本身不当作姓，空名字不出错', () => {
    expect(avatarText('工')).toBe('工');
    expect(avatarText('')).toBe('');
  });
});
